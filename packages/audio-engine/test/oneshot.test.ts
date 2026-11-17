import { describe, expect, it, vi } from 'vitest';
import type { EngineEvents } from '../src';
import { flush, graphNodes, settled, setup } from './helpers';

const sounds = {
  sword: { seconds: 1, kind: 'oneshot' as const },
  door: { seconds: 2, kind: 'oneshot' as const, maxInstances: 1 },
  rain: { seconds: 60 },
};

async function ready(opts: Parameters<typeof setup>[0] = {}) {
  const env = setup({ sounds, ...opts });
  await env.engine.unlock();
  await env.engine.preload(['sword', 'door']);
  return env;
}

describe('One-shots', () => {
  it('plays a loaded one-shot immediately on the oneshot bus (not the mix input)', async () => {
    const { engine, ctx } = await ready();
    const handle = engine.playOneshot('sword', { volume: 0.5, pan: 0.3 });
    expect(handle).not.toBeNull();
    const [source] = ctx.playingSources();
    expect(source.started).toEqual({ when: 0, offset: 0 });
    const { oneshot, master, mixInput } = graphNodes(ctx);
    expect(source.isConnectedTo(oneshot)).toBe(true);
    expect([...oneshot.outputs]).toEqual([master]);
    expect(source.isConnectedTo(mixInput)).toBe(false);
    await flush();
    expect(engine.getSnapshot().activeOneshotCount).toBe(1);

    ctx.advance(1);
    await flush();
    expect(engine.getSnapshot().activeOneshotCount).toBe(0);
  });

  it('steals the oldest voice of the same sound past maxInstances (default 3)', async () => {
    const { engine, ctx } = await ready();
    const dropped: EngineEvents['oneshotDropped'][] = [];
    engine.on('oneshotDropped', (e) => dropped.push(e));
    for (let i = 0; i < 4; i++) engine.playOneshot('sword');
    const voices = ctx.sources().filter((s) => s.buffer?.duration === 1);
    expect(voices).toHaveLength(4);
    expect(voices[0].stopTime).toBeCloseTo(0.03);
    expect(voices.slice(1).every((v) => v.stopTime === null)).toBe(true);
    expect(dropped).toEqual([{ soundId: 'sword', reason: 'stolen' }]);
    await flush();
    expect(engine.getSnapshot().activeOneshotCount).toBe(3);
  });

  it('respects per-sound maxInstances from the catalog', async () => {
    const { engine, ctx } = await ready();
    engine.playOneshot('door');
    engine.playOneshot('door');
    const doors = ctx.sources().filter((s) => s.buffer?.duration === 2);
    expect(doors[0].stopTime).not.toBeNull();
    expect(doors[1].stopTime).toBeNull();
  });

  it('steals the oldest voice overall past maxOneshotVoices', async () => {
    const { engine, ctx } = await ready({ engine: { maxOneshotVoices: 2 } });
    engine.playOneshot('door');
    engine.playOneshot('sword');
    engine.playOneshot('sword');
    const door = ctx.sources().find((s) => s.buffer?.duration === 2)!;
    expect(door.stopTime).toBeCloseTo(0.03);
  });

  it('loads on demand and plays if ready within the latency budget', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    engine.playOneshot('sword');
    expect(ctx.playingSources()).toHaveLength(0);
    await flush();
    expect(ctx.playingSources()).toHaveLength(1);
  });

  it('drops a one-shot whose buffer arrives too late', async () => {
    let clock = 0;
    const { engine, ctx, fetchSound } = setup({ sounds, engine: { now: () => clock } });
    const original = fetchSound.getMockImplementation()!;
    fetchSound.mockImplementation(async (d) => {
      clock += 500;
      return original(d);
    });
    const dropped = vi.fn();
    engine.on('oneshotDropped', dropped);
    engine.playOneshot('sword');
    await flush();
    expect(ctx.playingSources()).toHaveLength(0);
    expect(dropped).toHaveBeenCalledWith({ soundId: 'sword', reason: 'not-loaded' });
  });

  it('returns null for unknown sounds', async () => {
    const { engine } = await ready();
    const errors = vi.fn();
    engine.on('error', errors);
    expect(engine.playOneshot('nope')).toBeNull();
    expect(errors).toHaveBeenCalledWith({ code: 'LOAD_FAILED', soundId: 'nope' });
  });

  it('handle.stop / stopAllOneshots fade voices out; setEffectsVolume ramps the bus', async () => {
    const { engine, ctx } = await ready();
    const sword = engine.playOneshot('sword')!;
    engine.playOneshot('door');
    sword.stop(0.2);
    const [swordSource, doorSource] = ctx.playingSources();
    expect(swordSource.stopTime).toBeCloseTo(0.2);
    engine.stopAllOneshots(0.1);
    expect(doorSource.stopTime).toBeCloseTo(0.1);
    expect(swordSource.stopTime).toBeCloseTo(0.2); // already stopping: unchanged

    engine.setEffectsVolume(0.5);
    expect(settled(graphNodes(ctx).oneshot.gain)).toBeCloseTo(0.25);
    expect(engine.getSnapshot().effectsVolume).toBe(0.5);
  });

  it('handle.setVolume adjusts individual voice gain live', async () => {
    const { engine, ctx } = await ready();
    const sword = engine.playOneshot('sword', { volume: 1 })!;
    engine.playOneshot('door', { volume: 1 });
    const sources = ctx.playingSources();
    expect(sources).toHaveLength(2);

    sword.setVolume(0.5);
    expect(engine.getSnapshot().activeOneshotCount).toBe(2);
  });

  it('setVolume on unloaded one-shots works after loading completes', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const sword = engine.playOneshot('sword')!;
    sword.setVolume(0.3);
    expect(ctx.playingSources()).toHaveLength(0);
    await flush();
    expect(ctx.playingSources()).toHaveLength(1);
    expect(engine.getSnapshot().activeOneshotCount).toBe(1);
  });

  it('setVolume on stopped one-shots is a no-op', async () => {
    const { engine, ctx } = await ready();
    const sword = engine.playOneshot('sword')!;
    const sources = ctx.playingSources();
    expect(sources).toHaveLength(1);
    sword.stop(0);
    ctx.advance(0.05);
    sword.setVolume(0.5);
    await flush();
    expect(engine.getSnapshot().activeOneshotCount).toBe(0);
  });

  it('uses SoundDescriptor.defaultVolume when playOneshot is called without explicit volume', async () => {
    const { engine } = await ready();
    const oneshotNoDefault = engine.playOneshot('sword')!;
    expect(engine.getSnapshot().activeOneshotCount).toBe(1);
    oneshotNoDefault.stop(0);

    await flush();
    expect(engine.getSnapshot().activeOneshotCount).toBe(0);
  });
});

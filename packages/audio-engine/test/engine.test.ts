import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvents } from '../src';
import { flush, graphNodes, layer, layerNodes, settled, setup } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('status & store', () => {
  it('goes uninitialized → locked → playing', async () => {
    const { engine, ctx } = setup();
    expect(engine.getSnapshot().status).toBe('uninitialized');

    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    expect(engine.getSnapshot().status).toBe('locked');

    await engine.unlock();
    expect(ctx.state).toBe('running');
    expect(engine.getSnapshot().status).toBe('playing');
  });

  it('keeps the snapshot reference stable and batches notifications', async () => {
    const { engine } = setup();
    const listener = vi.fn();
    engine.subscribe(listener);
    const before = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(before);

    engine.setMasterVolume(0.5);
    engine.setMasterVolume(0.6);
    expect(engine.getSnapshot()).not.toBe(before);
    expect(engine.getSnapshot().masterVolume).toBe(0.6);
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a mix started while locked plays as soon as the context unlocks', async () => {
    const { engine, ctx } = setup();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();
    expect(ctx.playingSources()).toHaveLength(1);
    expect(engine.getSnapshot().status).toBe('locked');
    await engine.unlock();
    expect(engine.getSnapshot().status).toBe('playing');
  });

  it('reports UNLOCK_FAILED and stays locked when resume() is rejected', async () => {
    const { engine } = setup({ ctx: { resumeRejects: true } });
    const errors: EngineEvents['error'][] = [];
    engine.on('error', (e) => errors.push(e));
    await engine.unlock();
    expect(errors.map((e) => e.code)).toEqual(['UNLOCK_FAILED']);
    expect(engine.getSnapshot().status).toBe('locked');
  });

  it('unlocks on the first user gesture and removes its listeners', async () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, 'removeEventListener');
    const { engine, ctx } = setup({ engine: { autoUnlock: target } });
    engine.playMix({ id: 'm', name: 'Rainy', layers: [] });
    target.dispatchEvent(new Event('click'));
    await flush();
    expect(ctx.state).toBe('running');
    expect(remove).toHaveBeenCalled();
  });

  it('reports the iOS interrupted state', async () => {
    const { engine, ctx } = setup();
    const statuses: string[] = [];
    engine.on('statusChange', (e) => statuses.push(e.status));
    await engine.unlock();
    ctx.simulateInterruption();
    expect(engine.getSnapshot().status).toBe('interrupted');
    expect(statuses).toEqual(['locked', 'idle', 'interrupted']);
  });
});

describe('loop layers', () => {
  it('plays a gapless loop with catalog loop points and a random start inside the loop', async () => {
    const { engine, ctx } = setup({
      sounds: { rain: { seconds: 60, loopStart: 0.05, loopEnd: 59.9 } },
    });
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();

    const [source] = ctx.playingSources();
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.05);
    expect(source.loopEnd).toBe(59.9);
    // rng = 0.5 → middle of the loop region
    expect(source.started?.offset).toBeCloseTo(0.05 + 0.5 * (59.9 - 0.05));
    expect(source.isConnectedTo(ctx.destination)).toBe(true);
    expect(engine.getSnapshot().mix?.layers[0].load).toBe('ready');
  });

  it('starts at the track start when randomStart is false', async () => {
    const { engine, ctx } = setup({
      sounds: { rain: { seconds: 60, loopStart: 1, trackStart: 0.5 } },
    });
    engine.playMix({
      id: 'm',
      name: 'Rainy',
      layers: [layer('l1', 'rain', { mode: { type: 'loop', randomStart: false } })],
    });
    await flush();
    expect(ctx.playingSources()[0].started?.offset).toBe(0.5);
    expect(ctx.playingSources()[0].loopStart).toBe(1);
  });

  it('routes source → voice → panner → layer → mute → mix input', async () => {
    const { engine, ctx } = setup();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain', { pan: -0.5 })] });
    await flush();
    const nodes = layerNodes(ctx.playingSources()[0]);
    expect(nodes.panner.kind).toBe('stereoPanner');
    expect((nodes.panner as unknown as { pan: { value: number } }).pan.value).toBe(-0.5);
    expect(nodes.out).toBe(graphNodes(ctx).mixInput);
  });

  it('maps volume perceptually, applies gainDb, and keeps volume on mute', async () => {
    const { engine, ctx } = setup({ sounds: { rain: { seconds: 60, gainDb: -6 } } });
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain', { volume: 0.5 })] });
    await flush();
    const { layerGain, mute } = layerNodes(ctx.playingSources()[0]);
    const dbGain = 10 ** (-6 / 20);
    expect(layerGain.gain.value).toBeCloseTo(0.25 * dbGain);

    engine.updateLayer('l1', { muted: true });
    expect(settled(mute.gain)).toBeCloseTo(0);
    expect(settled(layerGain.gain)).toBeCloseTo(0.25 * dbGain);

    engine.updateLayer('l1', { muted: false, volume: 1 });
    expect(settled(mute.gain)).toBeCloseTo(1);
    expect(settled(layerGain.gain)).toBeCloseTo(dbGain);
    expect(engine.getSnapshot().mix?.layers[0]).toMatchObject({ muted: false, volume: 1 });
  });

  it('smooths volume changes (no instant jumps)', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();
    const { layerGain } = layerNodes(ctx.playingSources()[0]);
    engine.updateLayer('l1', { volume: 0 });
    ctx.advance(0.005);
    expect(layerGain.gain.value).toBeGreaterThan(0.5);
    ctx.advance(0.2);
    expect(layerGain.gain.value).toBeLessThan(0.01);
  });

  it('replaces the source when the soundId changes', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();
    const [old] = ctx.playingSources();
    engine.updateLayer('l1', { soundId: 'wind' });
    expect(engine.getSnapshot().mix?.layers[0]).toMatchObject({ soundId: 'wind', load: 'loading' });
    await flush();
    ctx.advance(1);
    expect(old.ended).toBe(true);
    const [current] = ctx.playingSources();
    expect(current.buffer?.duration).toBe(30);
    expect(engine.getSnapshot().mix?.layers[0].load).toBe('ready');
  });

  it('adds and removes layers', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    engine.addLayer(layer('l2', 'wind'));
    await flush();
    expect(ctx.playingSources()).toHaveLength(2);

    engine.removeLayer('l1', { fadeSec: 0.5 });
    expect(engine.getSnapshot().mix?.layers.map((l) => l.id)).toEqual(['l2']);
    ctx.advance(0.6);
    expect(ctx.playingSources()).toHaveLength(1);
  });

  it('addLayer without a mix starts a custom mix', async () => {
    const { engine } = setup();
    engine.addLayer(layer('l1', 'rain'));
    expect(engine.getSnapshot().mix).toMatchObject({ id: 'custom', layers: [{ id: 'l1' }] });
  });

  it('applies new loop points live via refreshSound', async () => {
    const { engine, ctx, sounds } = setup();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();
    sounds.rain.loopStart = 2;
    sounds.rain.loopEnd = 50;
    engine.refreshSound('rain');
    const [source] = ctx.playingSources();
    expect([source.loopStart, source.loopEnd]).toEqual([2, 50]);
  });

  it('reports load and decode errors per layer', async () => {
    const { engine, ctx } = setup({
      ctx: {
        decode: () => {
          throw new Error('bad');
        },
      },
    });
    const errors: EngineEvents['error'][] = [];
    engine.on('error', (e) => errors.push(e));
    engine.playMix({
      id: 'm',
      name: 'Broken',
      layers: [layer('l1', 'missing'), layer('l2', 'rain')],
    });
    await flush();
    expect(engine.getSnapshot().mix?.layers.map((l) => l.load)).toEqual(['error', 'error']);
    expect(errors).toMatchObject([
      { code: 'LOAD_FAILED', soundId: 'missing' },
      { code: 'DECODE_FAILED', soundId: 'rain' },
    ]);
    expect(ctx.playingSources()).toHaveLength(0);
  });
});

describe('mix switching & transport', () => {
  it('pause fades out then suspends; resume restores master volume', async () => {
    vi.useFakeTimers();
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    engine.setMasterVolume(0.8);
    const { master } = graphNodes(ctx);

    const paused = engine.pause();
    expect(engine.getSnapshot().status).toBe('paused');
    expect(settled(master.gain)).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    await paused;
    expect(ctx.state).toBe('suspended');

    await engine.resume();
    expect(ctx.state).toBe('running');
    expect(engine.getSnapshot().status).toBe('playing');
    expect(settled(master.gain)).toBeCloseTo(0.64);
  });

  it('stop clears the mix', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] });
    await flush();
    engine.stop({ fadeSec: 0.2 });
    expect(engine.getSnapshot()).toMatchObject({ mix: null, status: 'idle' });
    ctx.advance(0.3);
    expect(ctx.playingSources()).toHaveLength(0);
  });

  it('builds mixInput → master → limiter → destination', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const { mixInput, master, oneshot } = graphNodes(ctx);
    expect([...mixInput.outputs]).toEqual([master]);
    expect([...oneshot.outputs]).toEqual([master]);
    const [limiter] = [...master.outputs];
    expect((limiter as { kind: string }).kind).toBe('dynamicsCompressor');
    expect(master.isConnectedTo(ctx.destination)).toBe(true);
  });

  it('dispose closes the context', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    await engine.dispose();
    expect(ctx.state).toBe('closed');
    expect(engine.getSnapshot().status).toBe('uninitialized');
  });
});

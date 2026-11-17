import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MixConfig } from '../src';
import { encodeFakeAudio, type FakeAudioContext } from '../src/testing';
import { flush, layer, layerNodes, setup, tick } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const sounds = { rain: { seconds: 60 }, wind: { seconds: 30 }, fire: { seconds: 20 } };
const mixA: MixConfig = { id: 'a', name: 'Rain', layers: [layer('a1', 'rain')] };
const mixB: MixConfig = { id: 'b', name: 'Wind', layers: [layer('b1', 'wind')] };

const byDuration = (ctx: FakeAudioContext, d: number) =>
  ctx.sources().filter((s) => s.buffer?.duration === d);

/** Starts mix A and lets it fade in fully (audio clock at 1 s). */
async function playingA(opts: Parameters<typeof setup>[0] = {}) {
  const env = setup({ sounds, ...opts });
  await env.engine.unlock();
  env.engine.playMix(mixA);
  await flush();
  await tick(env.ctx, 1);
  return env;
}

describe('scene crossfade', () => {
  it('first mix starts without a transition', async () => {
    const { engine } = await playingA();
    expect(engine.getSnapshot().transition).toBeNull();
  });

  it('equal-power crossfades the old mix out and the new one in', async () => {
    const { engine, ctx } = await playingA();
    const [rain] = byDuration(ctx, 60);
    engine.playMix(mixB, { crossfadeSec: 2 });
    expect(engine.getSnapshot().transition).toMatchObject({
      fromMixId: 'a',
      toMixId: 'b',
      waiting: true,
    });
    await flush();

    const [wind] = byDuration(ctx, 30);
    const out = layerNodes(rain).voice.gain;
    const inc = layerNodes(wind).voice.gain;
    expect(out.valueAt(1)).toBeCloseTo(1);
    expect(inc.valueAt(1)).toBeCloseTo(0);
    // Mid-point: cos² + sin² = 1 (constant power)
    expect(out.valueAt(2) ** 2 + inc.valueAt(2) ** 2).toBeCloseTo(1, 2);
    expect(out.valueAt(3)).toBeCloseTo(0);
    expect(inc.valueAt(3)).toBeCloseTo(1);
    expect(rain.stopTime).toBe(3);
    expect(engine.getSnapshot().transition).toMatchObject({
      waiting: false,
      endsAt: Date.now() + 2000,
    });
    expect(engine.getSnapshot().mix?.id).toBe('b');

    await tick(ctx, 2.1, 4);
    expect(rain.ended).toBe(true);
    expect(engine.getSnapshot().transition).toBeNull();
  });

  it('keeps a shared loop playing and glides it to the new volume', async () => {
    const { engine, ctx } = await playingA();
    engine.playMix(
      {
        id: 'b',
        name: 'Rain + wind',
        layers: [layer('b1', 'rain', { volume: 0.5 }), layer('b2', 'wind')],
      },
      { crossfadeSec: 2 },
    );
    await flush();
    const rains = byDuration(ctx, 60);
    expect(rains).toHaveLength(1);
    expect(rains[0].stopTime).toBeNull();
    const { layerGain, voice } = layerNodes(rains[0]);
    expect(layerGain.gain.valueAt(3)).toBeCloseTo(0.25);
    expect(voice.gain.valueAt(2)).toBeCloseTo(1);
    expect(engine.getSnapshot().mix?.layers.map((l) => [l.id, l.load])).toEqual([
      ['b1', 'ready'],
      ['b2', 'ready'],
    ]);
    // The carried layer is addressable under its new id.
    engine.updateLayer('b1', { muted: true });
    expect(layerNodes(rains[0]).mute.gain.valueAt(10)).toBeCloseTo(0);
  });

  it('restarts shared loops when reuseMatchingLayers is false', async () => {
    const { engine, ctx } = await playingA();
    engine.playMix(
      { id: 'b', name: 'Rain again', layers: [layer('b1', 'rain')] },
      { crossfadeSec: 2, reuseMatchingLayers: false },
    );
    await flush();
    const rains = byDuration(ctx, 60);
    expect(rains).toHaveLength(2);
    expect(rains[0].stopTime).toBe(3);
  });

  it('waits for the new sounds before fading (up to maxWaitSec)', async () => {
    const { engine, ctx, fetchSound } = await playingA();
    let release!: () => void;
    fetchSound.mockImplementationOnce(
      () =>
        new Promise<ArrayBuffer>((r) => {
          release = () => r(encodeFakeAudio({ seconds: 30 }));
        }),
    );
    const [rain] = byDuration(ctx, 60);
    engine.playMix(mixB, { crossfadeSec: 2 });
    await flush();
    expect(rain.stopTime).toBeNull();
    expect(engine.getSnapshot().transition?.waiting).toBe(true);

    await tick(ctx, 0.5);
    release();
    await flush();
    expect(rain.stopTime).toBeCloseTo(3.5);
    expect(engine.getSnapshot().transition?.waiting).toBe(false);
  });

  it('starts the fade after maxWaitSec even if a sound is still loading', async () => {
    const { engine, ctx, fetchSound } = await playingA();
    fetchSound.mockImplementationOnce(() => new Promise<ArrayBuffer>(() => {}));
    const [rain] = byDuration(ctx, 60);
    engine.playMix(mixB, { crossfadeSec: 2, maxWaitSec: 1 });
    await flush();
    await tick(ctx, 1);
    expect(rain.stopTime).toBeCloseTo(4);
  });

  it('a playMix during a pending crossfade fast-fades the oldest mix', async () => {
    const { engine, ctx, fetchSound } = await playingA();
    fetchSound.mockImplementationOnce(() => new Promise<ArrayBuffer>(() => {}));
    const [rain] = byDuration(ctx, 60);
    engine.playMix(mixB, { crossfadeSec: 2 });
    await flush();
    engine.playMix({ id: 'c', name: 'Fire', layers: [layer('c1', 'fire')] }, { crossfadeSec: 2 });
    expect(rain.stopTime).toBeCloseTo(1.3);
    expect(engine.getSnapshot().transition).toMatchObject({ fromMixId: 'b', toMixId: 'c' });
  });

  it('crossfadeSec 0 cuts without a transition', async () => {
    const { engine, ctx } = await playingA();
    const [rain] = byDuration(ctx, 60);
    engine.playMix(mixB, { crossfadeSec: 0 });
    expect(rain.stopTime).toBeCloseTo(1.05);
    expect(engine.getSnapshot().transition).toBeNull();
  });

  it('stop() during a crossfade clears the transition', async () => {
    const { engine } = await playingA();
    engine.playMix(mixB, { crossfadeSec: 2 });
    engine.stop();
    expect(engine.getSnapshot()).toMatchObject({ mix: null, transition: null });
  });
});

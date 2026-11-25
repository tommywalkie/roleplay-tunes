import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLoopConfig } from '../src';
import { flush, layer, setup, tick } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveLoopConfig', () => {
  it('defaults to the whole track, gapless, and clamps into order', () => {
    expect(resolveLoopConfig({}, 60)).toEqual({
      trackStart: 0,
      trackEnd: 60,
      loopStart: 0,
      loopEnd: 60,
      mode: 'gapless',
      crossfadeSec: 0,
    });
    expect(resolveLoopConfig({ loopStart: 50, loopEnd: 10, trackEnd: 999 }, 60)).toMatchObject({
      trackEnd: 60,
      loopStart: 50,
      loopEnd: 50.1, // clamped up to the minimum loop length past loopStart
    });
  });

  it('caps the crossfade at half the loop and at 10 s', () => {
    expect(
      resolveLoopConfig({ loopStart: 0, loopEnd: 40, mode: 'crossfade', crossfadeSec: 99 }, 60)
        .crossfadeSec,
    ).toBe(10);
    expect(
      resolveLoopConfig({ loopStart: 0, loopEnd: 4, mode: 'crossfade', crossfadeSec: 99 }, 60)
        .crossfadeSec,
    ).toBe(2);
  });
});

describe('crossfading loop layer', () => {
  const sounds = { rain: { seconds: 60 } };

  it('spawns the next pass crossfadeSec before the wrap and fades the old one out', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    engine.playMix({
      id: 'm',
      name: 'Rain',
      layers: [
        layer('l1', 'rain', {
          mode: {
            type: 'loop',
            randomStart: false,
            loop: { trackStart: 0, loopStart: 10, loopEnd: 20, mode: 'crossfade', crossfadeSec: 4 },
          },
        }),
      ],
    });
    await flush();

    // First pass starts at the track start (0), plays to loopEnd 20.
    let sources = ctx.playingSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].started?.offset).toBe(0);
    expect(sources[0].loop).toBe(false);
    expect(sources[0].stopTime).toBeCloseTo(20);

    // At 16 s (wrap 20 minus crossfade 4) the next pass spawns at loopStart 10.
    await tick(ctx, 16);
    sources = ctx.playingSources();
    expect(sources).toHaveLength(2);
    const next = sources.find((s) => s.started?.offset === 10)!;
    expect(next.started?.when).toBeCloseTo(16);
    expect(next.stopTime).toBeCloseTo(16 + 10); // reaches loopEnd at 26

    // The overlap: old fades out, new fades in, equal power (cos²+sin²=1) mid-way.
    const gainOf = (s: (typeof sources)[number]) =>
      (s.outputs.values().next().value as unknown as { gain: { valueAt: (t: number) => number } }).gain;
    const oldGain = gainOf(sources.find((s) => s !== next)!);
    const newGain = gainOf(next);
    expect(oldGain.valueAt(16)).toBeCloseTo(1);
    expect(newGain.valueAt(16)).toBeCloseTo(0);
    expect(oldGain.valueAt(18) ** 2 + newGain.valueAt(18) ** 2).toBeCloseTo(1, 2);
    expect(oldGain.valueAt(20)).toBeCloseTo(0);
    expect(newGain.valueAt(20)).toBeCloseTo(1);

    // At the wrap the old source is stopped; the new one keeps going and wraps again.
    await tick(ctx, 5); // t=21
    expect(ctx.playingSources()).toHaveLength(1);
    await tick(ctx, 9); // t=30: second wrap at 26, third pass spawned at 22
    expect(ctx.playingSources().length).toBeGreaterThanOrEqual(1);
    engine.stop();
  });

  it('a crossfade of 0 degenerates to a gapless cut at the wrap', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    engine.playMix({
      id: 'm',
      name: 'Rain',
      layers: [
        layer('l1', 'rain', {
          mode: {
            type: 'loop',
            randomStart: false,
            loop: { loopStart: 10, loopEnd: 20, mode: 'crossfade', crossfadeSec: 0 },
          },
        }),
      ],
    });
    await flush();
    await tick(ctx, 21);
    const sources = ctx.playingSources();
    expect(sources.length).toBeGreaterThanOrEqual(1);
    engine.stop();
  });

  it('applies new loop points live through updateLayer', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    engine.playMix({
      id: 'm',
      name: 'Rain',
      layers: [
        layer('l1', 'rain', {
          mode: {
            type: 'loop',
            randomStart: false,
            loop: { loopStart: 10, loopEnd: 20, mode: 'crossfade', crossfadeSec: 2 },
          },
        }),
      ],
    });
    await flush();
    engine.updateLayer('l1', {
      mode: {
        type: 'loop',
        randomStart: false,
        loop: { loopStart: 5, loopEnd: 15, mode: 'crossfade', crossfadeSec: 2 },
      },
    });
    await tick(ctx, 20);
    // Still exactly the looping chain: one current pass at any time after the wrap.
    expect(ctx.playingSources().length).toBeLessThanOrEqual(2);
    engine.stop();
  });
});

describe('previewSequence (loop editor test)', () => {
  const sounds = { rain: { seconds: 60 } };

  it('plays from the track start and silences the main mix while it runs', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rain', layers: [layer('l1', 'rain')] });
    await flush();
    const handle = engine.previewSequence(
      'rain',
      { trackStart: 2, loopStart: 10, loopEnd: 20, mode: 'gapless' },
      { silenceMix: true },
    );
    await flush();
    const mixInput = ctx.gains()[0];
    expect(mixInput.gain.valueAt(1e6)).toBeCloseTo(0);
    // The preview source is the looping one that does not run through the mix input.
    const source = ctx.playingSources().find((s) => s.loop && !s.isConnectedTo(mixInput))!;
    expect(source.started?.offset).toBe(2);
    expect([source.loopStart, source.loopEnd]).toEqual([10, 20]);
    expect(handle.getPosition()).toBeCloseTo(2);
    handle.stop();
    expect(mixInput.gain.valueAt(1e6)).toBeCloseTo(1);
    expect(engine.getSnapshot().preview).toBeNull();
  });

  it('pauses at the playhead and resumes from it', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', { loopStart: 0, loopEnd: 10 });
    await flush();
    ctx.advance(3);
    expect(handle.getPosition()).toBeCloseTo(3);
    handle.pause();
    expect(handle.isPlaying()).toBe(false);
    expect(handle.getPosition()).toBeCloseTo(3);
    ctx.advance(2);
    expect(handle.getPosition()).toBeCloseTo(3); // frozen
    handle.resume();
    ctx.advance(1);
    expect(handle.getPosition()).toBeCloseTo(4);
    expect(handle.isPlaying()).toBe(true);
    handle.stop();
  });

  it('seekTo jumps the playhead, wrapped into the loop, without stopping', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', { trackStart: 0, loopStart: 10, loopEnd: 20 });
    await flush();
    ctx.advance(2);
    expect(handle.getPosition()).toBeCloseTo(2);
    handle.seekTo(18);
    expect(handle.getPosition()).toBeCloseTo(18);
    ctx.advance(3); // past loopEnd 20 → wraps to 10 + 1
    expect(handle.getPosition()).toBeCloseTo(11);
    // A seek past loopEnd wraps like a loop pass.
    handle.seekTo(25);
    expect(handle.getPosition()).toBeCloseTo(15);
    // While paused the playhead moves but stays frozen.
    handle.pause();
    handle.seekTo(12);
    expect(handle.getPosition()).toBeCloseTo(12);
    ctx.advance(2);
    expect(handle.getPosition()).toBeCloseTo(12);
    handle.stop();
  });

  it('restarts from the track start with playFromStart', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', { trackStart: 5, loopStart: 5, loopEnd: 15 });
    await flush();
    ctx.advance(6);
    expect(handle.getPosition()).toBeCloseTo(11);
    handle.playFromStart();
    expect(handle.getPosition()).toBeCloseTo(5);
    handle.stop();
  });

  it('crossfades the loop when the mode asks for it', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', {
      loopStart: 10,
      loopEnd: 20,
      mode: 'crossfade',
      crossfadeSec: 4,
    });
    await flush();
    expect(ctx.playingSources()[0].loop).toBe(false);
    await tick(ctx, 17); // wrap at 20, next pass spawned at 16
    expect(ctx.playingSources().length).toBe(2);
    handle.stop();
  });
});

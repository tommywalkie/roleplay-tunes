import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePeaks, findZeroCrossing } from '../src';
import { loopPosition } from '../src/graph/layer';
import { FakeAudioBuffer } from '../src/testing';
import { flush, graphNodes, layer, settled, setup, tick } from './helpers';

describe('loopPosition', () => {
  const region = { loopStart: 2, loopEnd: 6 };
  it('plays forward into the loop, then wraps', () => {
    expect(loopPosition(0, 1, region)).toBe(1);
    expect(loopPosition(0, 5.5, region)).toBe(5.5);
    expect(loopPosition(0, 6, region)).toBe(2);
    expect(loopPosition(0, 7, region)).toBe(3);
    expect(loopPosition(5, 4, region)).toBe(5);
  });
});

describe('previewLoop', () => {
  it('plays the region on a preview bus and ducks the mix by 12 dB', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'wind')] });
    const handle = engine.previewLoop('rain', { loopStart: 1, loopEnd: 5 });
    expect(engine.getSnapshot().preview).toMatchObject({ soundId: 'rain', load: 'loading' });
    await flush();

    const source = ctx.playingSources().find((s) => s.buffer?.duration === 60)!;
    expect([source.loop, source.loopStart, source.loopEnd]).toEqual([true, 1, 5]);
    // The test sequence starts at the track start (0 by default), not at the loop start.
    expect(source.started?.offset).toBe(0);
    expect(source.isConnectedTo(graphNodes(ctx).master)).toBe(true);
    expect(source.isConnectedTo(graphNodes(ctx).mixInput)).toBe(false);
    expect(settled(graphNodes(ctx).mixInput.gain)).toBeCloseTo(10 ** (-12 / 20));
    expect(engine.getSnapshot().preview?.load).toBe('ready');

    handle.stop();
    expect(settled(graphNodes(ctx).mixInput.gain)).toBeCloseTo(1);
    expect(engine.getSnapshot().preview).toBeNull();
    ctx.advance(0.1);
    expect(source.ended).toBe(true);
  });

  it('updates loop points live on the same source and keeps the playhead', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const handle = engine.previewLoop('rain', { loopStart: 1, loopEnd: 5 });
    await flush();
    ctx.advance(2.5); // playhead at 2.5 (started at the track start 0)
    expect(handle.getPosition()).toBeCloseTo(2.5);

    handle.update({ loopStart: 0.5, loopEnd: 8 });
    const sources = ctx.playingSources();
    expect(sources).toHaveLength(1);
    expect([sources[0].loopStart, sources[0].loopEnd]).toEqual([0.5, 8]);
    expect(handle.getPosition()).toBeCloseTo(2.5);
    ctx.advance(6); // 8.5 → wraps to 0.5 + 0.5
    expect(handle.getPosition()).toBeCloseTo(1);
    expect(engine.getSnapshot().preview?.region).toMatchObject({ loopStart: 0.5, loopEnd: 8 });
  });

  it('wraps immediately when the new loopEnd is before the playhead', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const handle = engine.previewLoop('rain', { loopStart: 0, loopEnd: 10 });
    await flush();
    ctx.advance(7);
    handle.update({ loopStart: 2, loopEnd: 5 });
    expect(handle.getPosition()).toBeCloseTo(2 + ((7 - 2) % 3));
  });

  it('clamps regions to the buffer', async () => {
    const { engine } = setup();
    const handle = engine.previewLoop('rain', { loopStart: -1, loopEnd: 99 });
    await flush();
    expect(engine.getSnapshot().preview?.region).toMatchObject({ loopStart: 0, loopEnd: 60 });
    handle.update({ loopStart: 10, loopEnd: 10 });
    expect(engine.getSnapshot().preview?.region).toMatchObject({ loopStart: 10, loopEnd: 10.1 });
  });

  it('auditionSeam restarts just before loopEnd (also when requested before load)', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const handle = engine.previewLoop(
      'rain',
      { loopStart: 1, loopEnd: 20 },
      { auditionSeamSec: 3 },
    );
    await flush();
    expect(ctx.playingSources()[0].started?.offset).toBe(17);

    handle.auditionSeam();
    ctx.advance(0);
    const playing = ctx.playingSources();
    expect(playing).toHaveLength(1);
    expect(playing[0].started?.offset).toBe(18);
    expect(handle.getPosition()).toBe(18);
  });

  it('seekTo before the buffer loads starts playback at the seek position', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const handle = engine.previewLoop('rain', { loopStart: 1, loopEnd: 20 });
    handle.seekTo(5); // buffer not loaded yet: must be queued, not dropped
    await flush();
    expect(ctx.playingSources()[0].started?.offset).toBe(5);
    handle.stop();
  });

  it('a new preview replaces the previous one', async () => {
    const { engine, ctx } = setup();
    await engine.unlock();
    const first = engine.previewLoop('rain', { loopStart: 0, loopEnd: 10 });
    await flush();
    engine.previewLoop('wind', { loopStart: 0, loopEnd: 10 });
    await flush();
    ctx.advance(0.1);
    expect(ctx.playingSources().map((s) => s.buffer?.duration)).toEqual([30]);
    first.update({ loopStart: 1, loopEnd: 2 }); // stale handle: no-op
    expect(engine.getSnapshot().preview?.soundId).toBe('wind');
  });
});

describe('previewSequence switching between gapless and crossfade', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const sounds = { rain: { seconds: 60 } };
  /** Sources still sounding once the clock has settled at the current time. */
  const sounding = (ctx: ReturnType<typeof setup>['ctx']) => {
    ctx.advance(0);
    return ctx.playingSources();
  };

  it('a gapless test switched to crossfade restarts on a crossfading looper at the playhead', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', { loopStart: 0, loopEnd: 10 });
    await flush();
    const gapless = ctx.playingSources()[0];
    expect(gapless.loop).toBe(true);
    await tick(ctx, 3);

    handle.update({ mode: 'crossfade', crossfadeSec: 1 });
    const playing = sounding(ctx);
    expect(gapless.ended).toBe(true);
    expect(playing).toHaveLength(1);
    expect(playing[0]).not.toBe(gapless);
    expect(playing[0].loop).toBe(false);
    expect(playing[0].started?.offset).toBeCloseTo(3);
    expect(handle.getPosition()).toBeCloseTo(3);
    expect(handle.isPlaying()).toBe(true);
    handle.stop();
  });

  it('a crossfading test switched to gapless restarts on one looping source at the playhead', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', {
      loopStart: 0,
      loopEnd: 10,
      mode: 'crossfade',
      crossfadeSec: 1,
    });
    await flush();
    const voice = ctx.playingSources()[0];
    expect(voice.loop).toBe(false);
    await tick(ctx, 3);

    handle.update({ mode: 'gapless' });
    const playing = sounding(ctx);
    expect(voice.ended).toBe(true);
    expect(playing).toHaveLength(1);
    expect(playing[0].loop).toBe(true);
    expect([playing[0].loopStart, playing[0].loopEnd]).toEqual([0, 10]);
    expect(playing[0].started?.offset).toBeCloseTo(3);
    expect(handle.getPosition()).toBeCloseTo(3);
    handle.stop();
  });

  it('a crossfade of 0 plays gapless, and raising it switches to the looper', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', {
      loopStart: 0,
      loopEnd: 10,
      mode: 'crossfade',
      crossfadeSec: 0,
    });
    await flush();
    const first = ctx.playingSources()[0];
    expect(first.loop).toBe(true);
    await tick(ctx, 2);

    handle.update({ crossfadeSec: 1 });
    const playing = sounding(ctx);
    expect(first.ended).toBe(true);
    expect(playing).toHaveLength(1);
    expect(playing[0].loop).toBe(false);
    expect(playing[0].started?.offset).toBeCloseTo(2);
    expect(handle.getPosition()).toBeCloseTo(2);
    handle.stop();
  });

  it('a switch made while paused takes effect on resume, from the paused playhead', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const handle = engine.previewSequence('rain', {
      loopStart: 0,
      loopEnd: 10,
      mode: 'crossfade',
      crossfadeSec: 1,
    });
    await flush();
    await tick(ctx, 3);
    handle.pause();
    await tick(ctx, 1);
    const before = ctx.sources().length;

    handle.update({ mode: 'gapless' });
    // Still paused: nothing starts until resume.
    expect(ctx.sources().length).toBe(before);
    expect(handle.isPlaying()).toBe(false);

    handle.resume();
    const playing = sounding(ctx);
    expect(playing).toHaveLength(1);
    expect(playing[0].loop).toBe(true);
    expect(playing[0].started?.offset).toBeCloseTo(3);
    expect(handle.getPosition()).toBeCloseTo(3);
    expect(handle.isPlaying()).toBe(true);
    handle.stop();
  });

  it('updates that keep the same kind of player do not restart it', async () => {
    const { engine, ctx } = setup({ sounds });
    await engine.unlock();
    const gapless = engine.previewSequence('rain', { loopStart: 0, loopEnd: 10 });
    await flush();
    await tick(ctx, 3);
    let before = ctx.sources().length;
    gapless.update({ loopEnd: 8 });
    gapless.update({ mode: 'crossfade', crossfadeSec: 0 }); // still gapless
    expect(ctx.sources().length).toBe(before);
    expect(sounding(ctx)[0].loopEnd).toBe(8);
    gapless.stop();

    const crossfade = engine.previewSequence('rain', {
      loopStart: 0,
      loopEnd: 10,
      mode: 'crossfade',
      crossfadeSec: 1,
    });
    await flush();
    await tick(ctx, 3);
    before = ctx.sources().length;
    crossfade.update({ loopEnd: 8 });
    crossfade.update({ crossfadeSec: 2 });
    expect(ctx.sources().length).toBe(before);
    expect(crossfade.getPosition()).toBeCloseTo(3);
    crossfade.stop();
  });
});

describe('waveform helpers', () => {
  const makeBuffer = (samples: number[], channels = 1) => {
    const b = new FakeAudioBuffer({
      numberOfChannels: channels,
      length: samples.length,
      sampleRate: 10,
    });
    for (let c = 0; c < channels; c++) b.copyToChannel(Float32Array.from(samples), c);
    return b;
  };

  it('computePeaks returns max |sample| per bucket', () => {
    const peaks = computePeaks(makeBuffer([0.1, -0.5, 0.2, 0.3, -0.9, 0.4]), 3);
    expect(Array.from(peaks)).toEqual([
      expect.closeTo(0.5),
      expect.closeTo(0.3),
      expect.closeTo(0.9),
    ]);
  });

  it('findZeroCrossing snaps to the nearest sign change within the window', () => {
    // sign change between index 5 and 6 (t = 0.6)
    const b = makeBuffer([1, 1, 1, 1, 1, 1, -1, -1, -1, -1]);
    expect(findZeroCrossing(b, 0.4, 0.3)).toBeCloseTo(0.6);
    expect(findZeroCrossing(b, 0.1, 0.1)).toBe(0.1); // none in window
  });

  it('engine.getWaveformPeaks / snapToZeroCrossing load the sound', async () => {
    const { engine } = setup();
    const peaks = await engine.getWaveformPeaks('rain', 100);
    expect(peaks).toHaveLength(100);
    expect(await engine.snapToZeroCrossing('rain', 1.234)).toBeCloseTo(1.234, 2);
  });
});

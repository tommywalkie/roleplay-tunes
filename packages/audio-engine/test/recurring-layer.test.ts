import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerConfig } from '../src';
import type { FakeAudioContext, FakeAudioNode } from '../src/testing';
import { flush, layer, setup, tick } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type RecurringMode = Extract<LayerConfig['mode'], { type: 'recurring' }>;

const thunder = (patch: Partial<RecurringMode> = {}) =>
  layer('t', 'thunder', { mode: { type: 'recurring', minInterval: 4, maxInterval: 10, ...patch } });

const sounds = { thunder: { seconds: 3 }, rain: { seconds: 60 } };

async function start(config = thunder(), opts: Parameters<typeof setup>[0] = {}) {
  const env = setup({ sounds, ...opts });
  await env.engine.unlock();
  env.engine.playMix({ id: 'm', name: 'Storm', layers: [config] });
  await flush();
  return env;
}

const eventSources = (ctx: FakeAudioContext) =>
  ctx.sources().filter((s) => s.buffer?.duration === 3);

describe('recurring-interval layers', () => {
  it('plays the first event immediately and the next one U(min, max) after it ends', async () => {
    const { ctx } = await start();
    const events = eventSources(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].loop).toBe(false);
    expect(events[0].started?.when).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    // rng 0.5 → 0 + 3s clip + 4 + 0.5 * 6
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 10]);
  });

  it('applies volume and pan jitter per event', async () => {
    const { ctx } = await start(thunder({ volumeJitter: [0.5, 1], panJitter: 0.4 }), {
      engine: { rng: () => 0.75 },
    });
    const [source] = eventSources(ctx);
    const gain = [...source.outputs][0] as FakeAudioNode & { gain: { value: number } };
    const panner = [...gain.outputs][0] as FakeAudioNode & { pan: { value: number } };
    expect(gain.gain.value).toBeCloseTo(0.875);
    expect(panner.pan.value).toBeCloseTo(0.2);
  });

  it('keeps exactly one event queued ahead as time passes', async () => {
    const { ctx } = await start();
    await tick(ctx, 7.1, 10);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 10]); // 0 + 3s clip + 7
    await tick(ctx, 10, 10);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 10, 20]);
    const queued = eventSources(ctx).filter((s) => s.started!.when > ctx.currentTime);
    expect(queued).toHaveLength(1);
  });

  it('does not pile up events while the context is suspended', async () => {
    const { ctx, engine } = setup({ sounds });
    engine.playMix({ id: 'm', name: 'Storm', layers: [thunder()] }); // locked: clock frozen
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    // The first play's timer is on time even at a frozen clock, so the second is queued.
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 10]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 10]);
  });

  it('skips missed events after a throttled timer (no burst)', async () => {
    const { ctx } = await start();
    ctx.advance(30); // audio clock runs while JS timers are throttled
    await vi.advanceTimersByTimeAsync(7000);
    // 0 + 3 + 7 = 10 was missed → rescheduled from now (30) + 7
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 37]);
  });

  it('never overlaps plays when the clip is longer than the pause', async () => {
    const { ctx } = await start(
      layer('r', 'rain', { mode: { type: 'recurring', minInterval: 1, maxInterval: 1 } }),
    );
    await tick(ctx, 62.05, 20);
    const rain = ctx.sources().filter((s) => s.buffer?.duration === 60);
    expect(rain.map((s) => s.started?.when)).toEqual([0, 61, 122]); // start + 60s clip + 1
    for (let i = 1; i < rain.length; i++) {
      expect(rain[i].started!.when).toBeGreaterThanOrEqual(rain[i - 1].started!.when + 60);
    }
    expect(rain.map((s) => s.stopTime)).toEqual([null, null, null]); // no voice stealing
  });

  it('uses updated intervals for the next event', async () => {
    const { ctx, engine } = await start();
    engine.updateLayer('t', { mode: { type: 'recurring', minInterval: 1, maxInterval: 1 } });
    await tick(ctx, 0.1);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([0, 4]); // 0 + 3s clip + 1
  });

  it('stops scheduling and cancels queued events when removed', async () => {
    const { ctx, engine } = await start();
    engine.removeLayer('t', { fadeSec: 0.5 });
    const [queued] = eventSources(ctx);
    expect(queued.stopTime).toBe(0.5);
    await tick(ctx, 60, 20);
    expect(eventSources(ctx)).toHaveLength(1);
  });
});

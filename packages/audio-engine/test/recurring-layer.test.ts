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
  it('queues one non-looping event at now + U(min, max)', async () => {
    const { ctx } = await start();
    const events = eventSources(ctx);
    expect(events).toHaveLength(1);
    expect(events[0].loop).toBe(false);
    expect(events[0].started?.when).toBe(7); // rng 0.5 → 4 + 0.5 * 6
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
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([7, 14]);
    await tick(ctx, 7, 10);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([7, 14, 21]);
    const queued = eventSources(ctx).filter((s) => s.started!.when > ctx.currentTime);
    expect(queued).toHaveLength(1);
  });

  it('does not pile up events while the context is suspended', async () => {
    const { ctx, engine } = setup({ sounds });
    engine.playMix({ id: 'm', name: 'Storm', layers: [thunder()] }); // locked: clock frozen
    await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(eventSources(ctx)).toHaveLength(1);
  });

  it('skips missed events after a throttled timer (no burst)', async () => {
    const { ctx } = await start();
    ctx.advance(30); // audio clock runs while JS timers are throttled
    await vi.advanceTimersByTimeAsync(7000);
    // 7 + 7 = 14 was missed → rescheduled from now (30) + 7
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([7, 37]);
  });

  it('limits overlap to 2 voices by fading the oldest', async () => {
    const { ctx } = await start(
      layer('r', 'rain', { mode: { type: 'recurring', minInterval: 1, maxInterval: 1 } }),
    );
    await tick(ctx, 2.05, 4);
    const rain = ctx.sources().filter((s) => s.buffer?.duration === 60);
    expect(rain.map((s) => s.started?.when)).toEqual([1, 2, 3]);
    expect(rain[0].stopTime).toBeCloseTo(3.03);
    expect(rain[1].stopTime).toBeNull();
  });

  it('uses updated intervals for the next event', async () => {
    const { ctx, engine } = await start();
    engine.updateLayer('t', { mode: { type: 'recurring', minInterval: 1, maxInterval: 1 } });
    await tick(ctx, 7.1, 10);
    expect(eventSources(ctx).map((s) => s.started?.when)).toEqual([7, 8]);
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

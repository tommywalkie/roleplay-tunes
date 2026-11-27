import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeAudioBufferSourceNode, FakeAudioContext, FakeGainNode } from '../src/testing';
import type { SequenceItem } from '../src';
import { flush, layer, setup, tick as tickOnce } from './helpers';

/** Moves the audio clock and the timers together in 50 ms steps, as they run for real. */
const tick = (ctx: FakeAudioContext, sec: number) =>
  tickOnce(ctx, sec, Math.max(1, Math.round(sec / 0.05)));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** a: 10 s, heard from 1 to 9 (8 s). b: 20 s, whole. c: 6 s, whole. */
const sounds = {
  a: { seconds: 10, trackStart: 1, trackEnd: 9 },
  b: { seconds: 20 },
  c: { seconds: 6 },
};

const items = (...ids: string[]): SequenceItem[] => ids.map((soundId) => ({ soundId, volume: 1 }));

const playlist = (list: SequenceItem[], id = 'pl', crossfadeSec?: number) =>
  layer(id, list[0].soundId, { mode: { type: 'sequence', items: list, crossfadeSec } });

/** Sources of real sounds that were started, in creation order. */
const started = (ctx: FakeAudioContext) =>
  ctx.sources().filter((s) => s.started && s.buffer && s.buffer.length > 1);
const lengthOf = (s: FakeAudioBufferSourceNode) => s.buffer!.duration;
/** The gain right after a source: its fade envelope. */
const envOf = (s: FakeAudioBufferSourceNode) =>
  (s.outputs.values().next().value as unknown as FakeGainNode).gain;

async function playing(list: SequenceItem[], crossfadeSec?: number) {
  const env = setup({ sounds });
  await env.engine.unlock();
  env.engine.playMix({ id: 'm', name: 'Road', layers: [playlist(list, 'pl', crossfadeSec)] });
  await flush();
  return env;
}

const current = (engine: ReturnType<typeof setup>['engine'], id = 'pl') =>
  engine.getSnapshot().mix?.layers.find((l) => l.id === id)?.current;

describe('sequence layer (playlist)', () => {
  it('plays the items one after another from their track start, gapless, and wraps around', async () => {
    const { engine, ctx } = await playing(items('a', 'b', 'c'));
    let s = started(ctx);
    expect(s).toHaveLength(1);
    expect(lengthOf(s[0])).toBe(10);
    expect(s[0].loop).toBe(false);
    expect(s[0].started).toEqual({ when: 0, offset: 1 });

    // a plays 8 s (1 to 9): b starts exactly at 8, from 0.
    await tick(ctx, 7.5);
    s = started(ctx);
    expect(s).toHaveLength(2);
    expect(lengthOf(s[1])).toBe(20);
    expect(s[1].started?.when).toBeCloseTo(8);
    expect(s[1].started?.offset).toBe(0);

    // b plays 20 s: c at 28. c plays 6 s: back to a at 34, from its track start.
    await tick(ctx, 20);
    s = started(ctx);
    expect(lengthOf(s[2])).toBe(6);
    expect(s[2].started?.when).toBeCloseTo(28);
    await tick(ctx, 6);
    s = started(ctx);
    expect(s).toHaveLength(4);
    expect(lengthOf(s[3])).toBe(10);
    expect(s[3].started?.when).toBeCloseTo(34);
    expect(s[3].started?.offset).toBe(1);
    engine.stop();
  });

  it('reports the item being heard as `current`, once it starts', async () => {
    const { engine, ctx } = await playing(items('a', 'b', 'c'));
    await tick(ctx, 0.01);
    expect(current(engine)).toBe(0);
    // b is scheduled ahead (at 7) but only heard from 8.
    await tick(ctx, 7.5);
    expect(current(engine)).toBe(0);
    await tick(ctx, 0.6);
    expect(current(engine)).toBe(1);
    await tick(ctx, 20);
    expect(current(engine)).toBe(2);
    await tick(ctx, 6);
    expect(current(engine)).toBe(0);
    engine.stop();
  });

  it('blends each item into the next over the playlist’s crossfade, with equal power', async () => {
    const { engine, ctx } = await playing(items('a', 'b'), 2);
    await tick(ctx, 5.5);
    const [a, b] = started(ctx);
    // a would end at 8: b starts 2 s earlier and both overlap until 8.
    expect(b.started?.when).toBeCloseTo(6);
    const target = envOf(a).valueAt(1);
    expect(target).toBeGreaterThan(0);
    expect(envOf(a).valueAt(6)).toBeCloseTo(target);
    expect(envOf(b).valueAt(6)).toBeCloseTo(0);
    const mid = (envOf(a).valueAt(7) / target) ** 2 + (envOf(b).valueAt(7) / target) ** 2;
    expect(mid).toBeCloseTo(1, 1);
    expect(envOf(a).valueAt(8)).toBeCloseTo(0);
    expect(envOf(b).valueAt(8)).toBeCloseTo(target);
    engine.stop();
  });

  it('clamps the playlist’s crossfade to half the item', async () => {
    const { engine, ctx } = await playing(items('c', 'b'), 5);
    await tick(ctx, 2.5);
    const [, b] = started(ctx);
    // c lasts 6 s: at most 3 s of crossfade, so b starts at 3, not at 1.
    expect(b.started?.when).toBeCloseTo(3, 2);
    engine.stop();
  });

  it('blends the last item into the first when it wraps around', async () => {
    const { engine, ctx } = await playing(items('a', 'c'), 2);
    // a: 0 to 8, c from 6 (to 12), then a again from 10, overlapping c's last 2 s.
    await tick(ctx, 9.5);
    const s = started(ctx);
    expect(s).toHaveLength(3);
    const [, c, again] = s;
    expect(c.started?.when).toBeCloseTo(6);
    expect(lengthOf(again)).toBe(10);
    expect(again.started?.when).toBeCloseTo(10);
    expect(again.started?.offset).toBe(1);
    const target = envOf(c).valueAt(9);
    expect(target).toBeGreaterThan(0);
    expect(envOf(again).valueAt(10)).toBeCloseTo(0);
    const mid = (envOf(c).valueAt(11) / target) ** 2 + (envOf(again).valueAt(11) / target) ** 2;
    expect(mid).toBeCloseTo(1, 1);
    expect(envOf(c).valueAt(12)).toBeCloseTo(0);
    expect(envOf(again).valueAt(12)).toBeCloseTo(target);
    engine.stop();
  });

  it('plays back to back at a crossfade of 0, whatever an item’s own loop says', async () => {
    const list: SequenceItem[] = [
      { soundId: 'a', volume: 1, loop: { mode: 'crossfade', crossfadeSec: 2 } },
      { soundId: 'b', volume: 1, loop: { mode: 'crossfade', crossfadeSec: 2 } },
    ];
    const { engine, ctx } = await playing(list, 0);
    await tick(ctx, 7.5);
    const [a, b] = started(ctx);
    expect(b.started?.when).toBeCloseTo(8);
    const target = envOf(a).valueAt(1);
    expect(target).toBeGreaterThan(0);
    // No fade: a stays full to its end, b is full from its start.
    expect(envOf(a).valueAt(7.9)).toBeCloseTo(target);
    expect(envOf(b).valueAt(8)).toBeCloseTo(target);
    engine.stop();
  });

  it('applies a new crossfade of a carried playlist from the next hand-over not yet scheduled', async () => {
    const { engine, ctx } = await playing(items('a', 'b'), 0);
    await tick(ctx, 3);
    // a started with no crossfade: its hand-over to b, at 8, is already set.
    engine.playMix({ id: 'm2', name: 'Forest', layers: [playlist(items('a', 'b'), 'pl', 2)] });
    await flush();
    await tick(ctx, 4.5);
    let s = started(ctx);
    expect(s).toHaveLength(2);
    expect(s[1].started?.when).toBeCloseTo(8);
    // b (8 to 28) hands over to a with the new 2 s crossfade: a starts at 26.
    await tick(ctx, 18);
    s = started(ctx);
    expect(s).toHaveLength(3);
    expect(lengthOf(s[2])).toBe(10);
    expect(s[2].started?.when).toBeCloseTo(26);
    engine.stop();
  });

  it('skips forward and back, wrapping both ways', async () => {
    const { engine, ctx } = await playing(items('a', 'b', 'c'));
    await tick(ctx, 1);
    const [a] = started(ctx);

    engine.skipLayer('pl', 1);
    await tick(ctx, 0.01);
    let s = started(ctx);
    expect(a.stopTime).not.toBeNull();
    expect(lengthOf(s.at(-1)!)).toBe(20);
    expect(s.at(-1)!.started?.when).toBeCloseTo(1, 1);
    expect(current(engine)).toBe(1);

    engine.skipLayer('pl', -1);
    await tick(ctx, 0.01);
    expect(lengthOf(started(ctx).at(-1)!)).toBe(10);
    expect(current(engine)).toBe(0);

    engine.skipLayer('pl', -1); // before the first: the last
    await tick(ctx, 0.01);
    expect(lengthOf(started(ctx).at(-1)!)).toBe(6);
    expect(current(engine)).toBe(2);

    engine.skipLayer('pl', 1); // after the last: the first
    await tick(ctx, 0.01);
    s = started(ctx);
    expect(lengthOf(s.at(-1)!)).toBe(10);
    expect(s.at(-1)!.started?.offset).toBe(1);
    expect(current(engine)).toBe(0);
    engine.stop();
  });

  it('skips an item that fails to load and goes on with the next', async () => {
    const { engine, ctx } = await playing(items('a', 'missing', 'c'));
    await tick(ctx, 8.5);
    const s = started(ctx);
    expect(s).toHaveLength(2);
    expect(lengthOf(s[1])).toBe(6);
    expect(s[1].started?.when).toBeCloseTo(8);
    await tick(ctx, 0.1);
    expect(current(engine)).toBe(2);
    engine.stop();
  });

  it('goes on where it was when the next mix carries the same playlist layer', async () => {
    const { engine, ctx } = await playing(items('a', 'b'));
    await tick(ctx, 3);
    const [a] = started(ctx);

    engine.playMix({ id: 'm2', name: 'Forest', layers: [playlist(items('a', 'b'))] });
    await flush();
    await tick(ctx, 1);
    expect(started(ctx)).toHaveLength(1);
    expect(a.stopTime).toBeNull();

    await tick(ctx, 4.5);
    const s = started(ctx);
    expect(s).toHaveLength(2);
    expect(lengthOf(s[1])).toBe(20);
    expect(s[1].started?.when).toBeCloseTo(8);
    engine.stop();
  });

  it('takes the new list of a carried playlist from the next item on', async () => {
    const { engine, ctx } = await playing(items('a', 'b'));
    await tick(ctx, 3);
    const [a] = started(ctx);

    engine.playMix({ id: 'm2', name: 'Forest', layers: [playlist(items('a', 'c'))] });
    await flush();
    await tick(ctx, 1);
    expect(started(ctx)).toHaveLength(1);
    expect(a.stopTime).toBeNull();

    // At the end of a, the new list's second item plays: c, not b.
    await tick(ctx, 4.5);
    const s = started(ctx);
    expect(s).toHaveLength(2);
    expect(lengthOf(s[1])).toBe(6);
    expect(s[1].started?.when).toBeCloseTo(8);
    await tick(ctx, 0.6);
    expect(current(engine)).toBe(1);
    engine.stop();
  });

  it('keeps reporting `current` right after a mix carries the playlist', async () => {
    const { engine, ctx } = await playing(items('a', 'b'));
    await tick(ctx, 9);
    expect(current(engine)).toBe(1);
    engine.playMix({ id: 'm2', name: 'Forest', layers: [playlist(items('a', 'b'))] });
    await flush();
    expect(current(engine)).toBe(1);
    engine.stop();
  });

  it('stops every source on stop', async () => {
    const { engine, ctx } = await playing(items('a', 'b'));
    await tick(ctx, 7.5); // b already scheduled
    expect(started(ctx)).toHaveLength(2);
    engine.stop();
    for (const s of started(ctx)) expect(s.stopTime).not.toBeNull();
    await tick(ctx, 2);
    expect(ctx.playingSources()).toHaveLength(0);
    await tick(ctx, 30);
    expect(started(ctx)).toHaveLength(2);
  });
});

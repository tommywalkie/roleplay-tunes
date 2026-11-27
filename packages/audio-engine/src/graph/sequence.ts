import { resolveLoopConfig } from '../loading/buffer-utils';

import { dbToGain, fadeTo, sliderToGain } from '../params';

import type { LoopConfig, SequenceItem, SoundDescriptor, SoundId, Timers } from '../types';

export interface SequenceDeps {
  ctx: BaseAudioContext;
  timers: Timers;
  load: (id: SoundId) => Promise<AudioBuffer>;
  resolve: (id: SoundId) => SoundDescriptor | undefined;
  /** Called when an item starts to be heard, with its index. */
  onIndex?: (index: number) => void;
}

/** One playing item: its source, the gain carrying its fades, and a gain for stop/skip. */
interface Voice {
  source: AudioBufferSourceNode;
  env: GainNode;
  kill: GainNode;
}

/** The next item is scheduled this long before it must start, so its buffer has time to load. */
const LOOKAHEAD_SEC = 1;
/** A timer firing this close to the event time counts as "on time". */
const TIMER_SLACK_SEC = 0.05;
const SKIP_FADE_SEC = 0.3;
const CURVE_STEPS = 64;
/** Shortest play of one item, so a broken track range never spins the scheduler. */
const MIN_ITEM_SEC = 0.05;

/** Equal-power curve from `from` to `to`, starting at `when`, built from explicit values. */
function curveFade(param: AudioParam, from: number, to: number, when: number, sec: number) {
  if (sec <= 0) {
    param.setValueAtTime(to, when);
    return;
  }
  const curve = new Float32Array(CURVE_STEPS);
  for (let i = 0; i < CURVE_STEPS; i++) {
    const x = (i / (CURVE_STEPS - 1)) * (Math.PI / 2);
    curve[i] = to >= from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x);
  }
  param.setValueCurveAtTime(curve, when, sec);
}

/**
 * A playlist: items play one after another, each from its track start to its track end,
 * and the list starts over after the last. Each item blends into the next over the
 * playlist's crossfade (the last into the first too); at 0 the next starts the moment the
 * previous ends. Everything is scheduled on the audio clock, one item ahead, with the next
 * buffer loaded in advance.
 */
export class Sequence {
  private items: SequenceItem[];
  private crossfadeSec: number;
  private index = -1;
  private voices: Voice[] = [];
  private timer: unknown = null;
  private stopped = false;
  /** Audio-clock time the next item starts, and the fade it starts with. */
  private next: { at: number; fadeIn: number } | null = null;
  /** Bumped on skip/stop, so late loads and timers of an older schedule are ignored. */
  private generation = 0;
  /** Items in a row that failed to load: once every item failed, the sequence gives up. */
  private failures = 0;
  /** Bumped when the list changes, so a next item armed from the old list is dropped. */
  private scheduleToken = 0;

  constructor(
    private deps: SequenceDeps,
    private destination: AudioNode,
    items: SequenceItem[],
    crossfadeSec = 0,
  ) {
    this.items = items;
    this.crossfadeSec = Math.max(0, crossfadeSec);
  }

  get currentIndex() {
    return this.index;
  }

  /** Starts with the first item, whose buffer the layer already has. */
  start(first: AudioBuffer) {
    if (this.stopped || this.items.length === 0) return;
    this.playAt(0, this.deps.ctx.currentTime, first, 0);
  }

  /**
   * New list (and crossfade): the item playing finishes, then the new list goes on from the
   * next index. A new crossfade applies from the next hand-over that is not yet scheduled.
   */
  setItems(items: SequenceItem[], crossfadeSec = this.crossfadeSec) {
    this.items = items;
    this.crossfadeSec = Math.max(0, crossfadeSec);
    this.scheduleToken++;
    if (items.length === 0) {
      this.clearTimer();
      return;
    }
    if (this.index >= items.length) this.index = items.length - 1;
    // The next item was loaded and armed from the old list: arm it again from the new one.
    if (this.next && !this.stopped) this.scheduleNext(this.generation);
  }

  /** Jumps `delta` items ahead (or back), wrapping around; the current item fades out fast. */
  skip(delta: number) {
    if (this.stopped || this.items.length === 0) return;
    const n = this.items.length;
    const target = (((this.index + delta) % n) + n) % n;
    this.generation++;
    this.clearTimer();
    this.next = null;
    this.killVoices(SKIP_FADE_SEC);
    this.loadAndPlay(target, this.generation);
  }

  stop(fadeSec: number) {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    this.clearTimer();
    this.killVoices(fadeSec);
  }

  private item(i: number): SequenceItem {
    return this.items[i % this.items.length];
  }

  private configOf(item: SequenceItem, buffer: AudioBuffer): LoopConfig {
    const d = this.deps.resolve(item.soundId);
    return resolveLoopConfig(
      {
        trackStart: d?.trackStart,
        trackEnd: d?.trackEnd,
        loopStart: d?.loopStart,
        loopEnd: d?.loopEnd,
        mode: d?.loopMode,
        crossfadeSec: d?.crossfadeSec,
        ...(item.loop ?? {}),
      },
      buffer.duration,
    );
  }

  /** Plays item `i` at `when`, fading in over `fadeIn`, and schedules the one after it. */
  private playAt(i: number, when: number, buffer: AudioBuffer, fadeIn: number) {
    const { ctx } = this.deps;
    const item = this.item(i);
    const cfg = this.configOf(item, buffer);
    const len = Math.max(MIN_ITEM_SEC, cfg.trackEnd - cfg.trackStart);
    // Both fades fit inside the item, one in each half, so their curves never overlap.
    const half = len / 2 - 0.001;
    const inSec = Math.max(0, Math.min(fadeIn, half));
    // The playlist's crossfade, not the item's own loop mode: a playlist plays no loops.
    const outSec = Math.max(0, Math.min(this.crossfadeSec, half));
    const target =
      sliderToGain(item.volume) * dbToGain(this.deps.resolve(item.soundId)?.gainDb ?? 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const env = ctx.createGain();
    const kill = ctx.createGain();
    env.gain.value = inSec > 0 ? 0 : target;
    if (inSec > 0) curveFade(env.gain, 0, target, when, inSec);
    if (outSec > 0) curveFade(env.gain, target, 0, when + len - outSec, outSec);
    source.connect(env).connect(kill).connect(this.destination);
    const voice: Voice = { source, env, kill };
    source.onended = () => {
      source.disconnect();
      env.disconnect();
      kill.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    source.start(when, cfg.trackStart, len);
    this.voices.push(voice);
    this.failures = 0;

    this.index = i;
    this.announce(i, when);
    this.next = { at: when + len - outSec, fadeIn: outSec };
    this.scheduleNext(this.generation);
  }

  /** Reports the item once it is actually heard, not when it was scheduled. */
  private announce(i: number, when: number) {
    const onIndex = this.deps.onIndex;
    if (!onIndex) return;
    const ms = Math.max(0, (when - this.deps.ctx.currentTime) * 1000);
    const generation = this.generation;
    this.deps.timers.setTimeout(() => {
      if (!this.stopped && generation === this.generation) onIndex(i);
    }, ms);
  }

  /** Loads the next item now, and arms a timer to place it shortly before it is due. */
  private scheduleNext(generation: number) {
    const next = this.next;
    if (!next || this.stopped || this.items.length === 0) return;
    const nextIndex = (this.index + 1) % this.items.length;
    const token = this.scheduleToken;
    const stale = () =>
      this.stopped || generation !== this.generation || token !== this.scheduleToken;
    const loading = this.deps.load(this.item(nextIndex).soundId);
    // A rejected load is handled when the timer fires; keep it from going unhandled.
    loading.catch(() => {});
    this.armTimer(next.at - LOOKAHEAD_SEC, () => {
      loading.then(
        (buffer) => {
          if (stale()) return;
          // Late (slow load, throttled timer): start as soon as possible, with no overlap.
          const at = Math.max(next.at, this.deps.ctx.currentTime);
          this.playAt(nextIndex, at, buffer, at === next.at ? next.fadeIn : 0);
        },
        () => {
          if (stale()) return;
          this.failed(nextIndex, next.at);
        },
      );
    });
  }

  /** Item `i` could not load: skip it, unless every item has failed in a row. */
  private failed(i: number, at: number) {
    this.failures++;
    if (this.failures >= this.items.length) return;
    this.index = i;
    this.next = { at, fadeIn: 0 };
    this.scheduleNext(this.generation);
  }

  /** Loads item `i` and plays it at once (after a skip). */
  private loadAndPlay(i: number, generation: number) {
    this.deps.load(this.item(i).soundId).then(
      (buffer) => {
        if (this.stopped || generation !== this.generation) return;
        this.playAt(i, this.deps.ctx.currentTime, buffer, 0);
      },
      () => {
        if (this.stopped || generation !== this.generation) return;
        this.failed(i, this.deps.ctx.currentTime);
      },
    );
  }

  /** Fires `cb` at audio-clock time `when`, waiting longer while the clock is held (paused). */
  private armTimer(when: number, cb: () => void) {
    this.clearTimer();
    const ms = Math.max(0, (when - this.deps.ctx.currentTime) * 1000);
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      if (this.deps.ctx.currentTime < when - TIMER_SLACK_SEC) {
        this.armTimer(when, cb);
        return;
      }
      cb();
    }, ms);
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private killVoices(fadeSec: number) {
    const now = this.deps.ctx.currentTime;
    for (const voice of this.voices) {
      fadeTo(voice.kill.gain, 0, now, fadeSec);
      voice.source.stop(now + Math.max(0, fadeSec));
    }
    this.voices = [];
  }
}

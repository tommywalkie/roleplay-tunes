import { resolveLoopConfig } from '../loading/buffer-utils';

import { clamp, equalPowerFade, fadeTo } from '../params';

import type { LoopConfig, Timers } from '../types';

import { loopPosition } from './layer';

/** A loop voice: one non-looping source with its own gain, stopped at its wrap time. */
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopAt: number;
}

export interface CrossfadeLoopDeps {
  ctx: BaseAudioContext;
  timers: Timers;
}

const STOP_FADE_SEC = 0.05;
const PAUSE_FADE_SEC = 0.03;

/**
 * A loop that blends each pass into the next instead of cutting at loopEnd: `crossfadeSec`
 * before the wrap, a new source starts at loopStart and fades in while the current one fades
 * out, so the seam is inaudible. Scheduling runs on injected timers against the audio clock.
 */
export class CrossfadeLoop {
  private voices: Voice[] = [];
  private buffer: AudioBuffer | null = null;
  private cfg: LoopConfig;
  private anchor = { time: 0, offset: 0 };
  private timer: unknown = null;
  /** Audio-clock time at which the current voice wraps to loopStart. */
  private nextWrapAt: number | null = null;
  private stopped = false;
  private paused = false;
  private pausedAt = 0;

  constructor(
    private deps: CrossfadeLoopDeps,
    private destination: AudioNode,
  ) {
    this.cfg = resolveLoopConfig({}, 0);
  }

  get config(): LoopConfig {
    return this.cfg;
  }

  get isPaused() {
    return this.paused;
  }

  /** Starts (or restarts) the loop at `offset` (defaults to the track start). */
  start(buffer: AudioBuffer, cfg: Partial<LoopConfig>, offset?: number) {
    this.clearTimer();
    this.killVoices(0);
    this.buffer = buffer;
    this.cfg = resolveLoopConfig(cfg, buffer.duration);
    this.stopped = false;
    this.paused = false;
    const now = this.deps.ctx.currentTime;
    const startOffset = clamp(offset ?? this.cfg.trackStart, 0, buffer.duration);
    // Normalize into the loop region, so a start past loopEnd wraps like a loop pass.
    const p0 = loopPosition(startOffset, 0, this.cfg);
    const wrapAt = now + (this.cfg.loopEnd - p0);
    this.spawn(now, p0, 1, wrapAt);
    this.anchor = { time: now, offset: p0 };
    this.nextWrapAt = wrapAt;
    this.schedule();
  }

  /** Live update of the loop settings; the playhead keeps its place. */
  update(cfg: Partial<LoopConfig>) {
    if (this.stopped) return;
    if (!this.buffer) {
      this.cfg = { ...this.cfg, ...cfg } as LoopConfig;
      return;
    }
    const position = this.getPosition();
    this.cfg = resolveLoopConfig({ ...this.cfg, ...cfg }, this.buffer.duration);
    const now = this.deps.ctx.currentTime;
    this.anchor = { time: now, offset: loopPosition(position, 0, this.cfg) };
    // The current voice may now wrap at a different time.
    const current = this.voices[this.voices.length - 1];
    if (current) {
      const wrapAt = now + Math.max(0, this.cfg.loopEnd - this.getPosition());
      current.source.stop(wrapAt);
      current.stopAt = wrapAt;
      this.nextWrapAt = wrapAt;
    }
    this.schedule();
  }

  getPosition(): number {
    if (this.paused) return this.pausedAt;
    if (this.voices.length === 0) return this.anchor.offset;
    return loopPosition(this.anchor.offset, this.deps.ctx.currentTime - this.anchor.time, this.cfg);
  }

  pause() {
    if (this.stopped || this.paused) return;
    this.paused = true;
    this.pausedAt = this.getPosition();
    this.clearTimer();
    const now = this.deps.ctx.currentTime;
    for (const voice of this.voices) {
      fadeTo(voice.gain.gain, 0, now, PAUSE_FADE_SEC);
      voice.source.stop(now + PAUSE_FADE_SEC);
    }
  }

  resume() {
    if (!this.paused || !this.buffer) return;
    this.paused = false;
    const at = this.pausedAt;
    this.killVoices(0);
    this.start(this.buffer, this.cfg, at);
  }

  stop(fadeSec = STOP_FADE_SEC) {
    if (this.stopped) return;
    this.stopped = true;
    this.paused = false;
    this.clearTimer();
    this.killVoices(fadeSec);
  }

  private effectiveCf(): number {
    if (this.cfg.mode !== 'crossfade') return 0;
    return clamp(this.cfg.crossfadeSec, 0, (this.cfg.loopEnd - this.cfg.loopStart) / 2);
  }

  /** Arms the timer that spawns the next pass `cf` seconds before the current one wraps. */
  private schedule() {
    this.clearTimer();
    if (this.stopped || this.paused || !this.buffer || this.nextWrapAt === null) return;
    const now = this.deps.ctx.currentTime;
    const cf = this.effectiveCf();
    // nextWrapAt always lies ahead of now after a spawn, so this never re-arms at 0 ms.
    const spawnAt = Math.max(now, this.nextWrapAt - cf);
    this.timer = this.deps.timers.setTimeout(
      () => this.onSpawn(spawnAt),
      Math.max(0, (spawnAt - now) * 1000),
    );
  }

  private onSpawn(spawnAt: number) {
    this.timer = null;
    if (this.stopped || this.paused || !this.buffer) return;
    const cf = this.effectiveCf();
    const len = this.cfg.loopEnd - this.cfg.loopStart;
    const stopAt = spawnAt + len;
    this.spawn(spawnAt, this.cfg.loopStart, 0, stopAt);
    // The previous voice fades out over the overlap and stops at its wrap.
    const current = this.voices[this.voices.length - 2];
    if (current) {
      equalPowerFade(current.gain.gain, 0, spawnAt, cf);
      current.source.stop(spawnAt + cf);
      current.stopAt = spawnAt + cf;
    }
    this.nextWrapAt = stopAt;
    this.schedule();
  }

  /** One voice: source at `offset` from `when`, gain ramped 0→target (or set to target) over the fade. */
  private spawn(when: number, offset: number, fromGain: number, stopAt: number) {
    const ctx = this.deps.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = false;
    const gain = ctx.createGain();
    gain.gain.value = fromGain;
    source.connect(gain);
    gain.connect(this.destination);
    const voice: Voice = { source, gain, stopAt };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
    };
    source.start(when, offset);
    source.stop(stopAt);
    if (fromGain < 1) equalPowerFade(gain.gain, 1, when, this.effectiveCf());
    this.voices.push(voice);
  }

  private clearTimer() {
    if (this.timer !== null) this.deps.timers.clearTimeout(this.timer);
    this.timer = null;
  }

  private killVoices(fadeSec: number) {
    this.clearTimer();
    const now = this.deps.ctx.currentTime;
    for (const voice of this.voices) {
      if (fadeSec > 0) fadeTo(voice.gain.gain, 0, now, fadeSec);
      voice.source.stop(now + Math.max(0, fadeSec));
    }
    this.voices = [];
  }
}

import { resolveLoopConfig } from '../loading/buffer-utils';

import { fadeTo } from '../params';

import type { LoopConfig } from '../types';

import { CrossfadeLoop } from './crossfade-loop';

import { loopPosition } from './layer';

export const DEFAULT_AUDITION_SEC = 2;
const STOP_FADE_SEC = 0.05;

/**
 * Loop editor test sequence: plays from the track start into the loop, gapless or crossfading
 * like the layer will, on its own gain. The whole sequence is editable live, can be paused and
 * resumed at the playhead, and restarted from the track start.
 * Requests made before the buffer is ready are applied when it arrives.
 */
export class LoopPreview {
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private looper: CrossfadeLoop | null = null;
  private buffer: AudioBuffer | null = null;
  /** Raw settings as given, before clamping to the buffer (unknown until it loads). */
  private raw: Partial<LoopConfig>;
  private anchor = { time: 0, offset: 0 };
  private pending: { cfg: Partial<LoopConfig>; offset?: number } | null = null;
  private stopped = false;
  private paused = false;
  private pausedAt = 0;

  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
    cfg: Partial<LoopConfig>,
    volume: number,
    private timers: {
      setTimeout: (cb: () => void, ms: number) => unknown;
      clearTimeout: (id: unknown) => void;
    },
  ) {
    this.raw = cfg;
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(destination);
  }

  /** The settings as they apply to the loaded buffer (raw until then). */
  get currentConfig(): LoopConfig {
    return resolveLoopConfig(this.raw, this.buffer?.duration ?? 0);
  }

  private get cfg(): LoopConfig {
    return this.currentConfig;
  }

  isPlaying(): boolean {
    return !this.stopped && !this.paused && (this.source !== null || this.looper !== null);
  }

  setBuffer(buffer: AudioBuffer) {
    if (this.stopped) return;
    this.buffer = buffer;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      if (pending.cfg) this.raw = { ...this.raw, ...pending.cfg };
      this.startAt(pending.offset ?? this.cfg.trackStart);
    } else {
      this.startAt(this.cfg.trackStart);
    }
  }

  /** Live update; returns the config actually applied (clamped to the buffer). */
  update(cfg: Partial<LoopConfig>): LoopConfig {
    if (this.stopped) return this.cfg;
    this.raw = { ...this.raw, ...cfg };
    if (!this.buffer) return this.cfg;
    const position = this.getPosition();
    const resolved = this.cfg;
    const now = this.ctx.currentTime;
    this.anchor = { time: now, offset: loopPosition(position, 0, resolved) };
    if (this.looper) {
      this.looper.update(resolved);
    } else if (this.source) {
      // loopStart/loopEnd are live attributes: no restart, no click.
      this.source.loopStart = resolved.loopStart;
      this.source.loopEnd = resolved.loopEnd;
    }
    return resolved;
  }

  /** Restarts the test sequence from the track start. */
  playFromStart() {
    if (this.stopped || !this.buffer) {
      if (!this.buffer) this.pending = { cfg: {}, offset: undefined };
      return;
    }
    this.paused = false;
    this.startAt(this.cfg.trackStart);
  }

  /** Jumps the playhead to `sec`; while paused it moves the frozen playhead. */
  seekTo(sec: number) {
    if (this.stopped) return;
    if (!this.buffer) {
      this.pending = { cfg: {}, offset: sec };
      return;
    }
    const at = Math.min(Math.max(sec, 0), this.buffer.duration);
    if (this.paused) {
      this.pausedAt = loopPosition(at, 0, this.cfg);
      return;
    }
    this.paused = false;
    this.startAt(at);
  }

  pause() {
    if (this.stopped || this.paused) return;
    this.pausedAt = this.getPosition();
    this.paused = true;
    if (this.looper) this.looper.pause();
    else if (this.source) {
      const now = this.ctx.currentTime;
      const source = this.source;
      this.source = null;
      source.onended = () => source.disconnect();
      source.stop(now);
    }
  }

  resume() {
    if (!this.paused || this.stopped || !this.buffer) return;
    this.paused = false;
    if (this.looper) this.looper.resume();
    else this.startAt(this.pausedAt);
  }

  auditionSeam(sec = DEFAULT_AUDITION_SEC) {
    if (this.stopped) return;
    // Before the buffer arrives its length is unknown: compute from the raw settings.
    const { loopStart, loopEnd } = this.buffer
      ? this.cfg
      : { loopStart: this.raw.loopStart ?? 0, loopEnd: this.raw.loopEnd ?? 0 };
    const at = Math.max(loopStart, loopEnd - sec);
    if (!this.buffer) {
      this.pending = { cfg: {}, offset: at };
      return;
    }
    this.paused = false;
    this.startAt(at);
  }

  getPosition(): number {
    if (this.paused) return this.pausedAt;
    if (this.looper) return this.looper.getPosition();
    if (!this.source) return this.cfg.loopStart;
    return loopPosition(this.anchor.offset, this.ctx.currentTime - this.anchor.time, this.cfg);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    fadeTo(this.gain.gain, 0, now, STOP_FADE_SEC);
    const gain = this.gain;
    if (this.looper) {
      this.looper.stop(STOP_FADE_SEC);
      this.looper = null;
    }
    const source = this.source;
    this.source = null;
    if (source) {
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.stop(now + STOP_FADE_SEC);
    } else {
      gain.disconnect();
    }
  }

  /** (Re)starts playback at `offset`, gapless or crossfading per the current config. */
  private startAt(offset: number) {
    if (!this.buffer) return;
    const now = this.ctx.currentTime;
    const crossfade = this.cfg.mode === 'crossfade' && this.cfg.crossfadeSec > 0.005;
    if (this.looper) {
      this.looper.stop(0);
      this.looper = null;
    }
    if (this.source) {
      const old = this.source;
      this.source = null;
      old.onended = () => old.disconnect();
      old.stop(now);
    }
    if (crossfade) {
      const looper = new CrossfadeLoop({ ctx: this.ctx, timers: this.timers }, this.gain);
      looper.start(this.buffer, this.cfg, offset);
      this.looper = looper;
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = this.cfg.loopStart;
    source.loopEnd = this.cfg.loopEnd;
    source.connect(this.gain);
    source.start(now, offset);
    this.source = source;
    this.anchor = { time: now, offset };
  }
}

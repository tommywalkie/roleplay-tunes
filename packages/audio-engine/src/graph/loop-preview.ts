import { clampRegion } from '../loading/buffer-utils';
import { fadeTo } from '../params';
import type { LoopRegion } from '../types';
import { loopPosition } from './layer';

export const DEFAULT_AUDITION_SEC = 2;
const STOP_FADE_SEC = 0.05;

/**
 * Loop-point editor preview: one looping source on its own gain, region editable live.
 * Region / seam requests made before the buffer is ready are applied when it arrives.
 */
export class LoopPreview {
  private gain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private anchor = { time: 0, offset: 0 };
  private pendingSeamSec: number | undefined;
  private stopped = false;

  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
    private region: LoopRegion,
    volume: number,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(destination);
  }

  get currentRegion(): LoopRegion {
    return this.region;
  }

  setBuffer(buffer: AudioBuffer) {
    if (this.stopped) return;
    this.buffer = buffer;
    this.region = clampRegion(this.region, buffer.duration);
    const seam = this.pendingSeamSec;
    this.pendingSeamSec = undefined;
    this.startAt(seam === undefined ? this.region.loopStart : this.seamOffset(seam));
  }

  /** Returns the region actually applied (clamped to the buffer). */
  update(region: LoopRegion): LoopRegion {
    if (this.stopped) return this.region;
    if (!this.buffer || !this.source) {
      this.region = region;
      return region;
    }
    const position = this.getPosition();
    this.region = clampRegion(region, this.buffer.duration);
    // loopStart/loopEnd are live attributes: no restart, no click.
    this.source.loopStart = this.region.loopStart;
    this.source.loopEnd = this.region.loopEnd;
    this.anchor = { time: this.ctx.currentTime, offset: loopPosition(position, 0, this.region) };
    return this.region;
  }

  auditionSeam(sec = DEFAULT_AUDITION_SEC) {
    if (this.stopped) return;
    if (!this.buffer) {
      this.pendingSeamSec = sec;
      return;
    }
    this.startAt(this.seamOffset(sec));
  }

  getPosition(): number {
    if (!this.source) return this.region.loopStart;
    return loopPosition(this.anchor.offset, this.ctx.currentTime - this.anchor.time, this.region);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    fadeTo(this.gain.gain, 0, now, STOP_FADE_SEC);
    const gain = this.gain;
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

  private seamOffset(sec: number) {
    return Math.max(this.region.loopStart, this.region.loopEnd - sec);
  }

  private startAt(offset: number) {
    if (!this.buffer) return;
    const now = this.ctx.currentTime;
    if (this.source) {
      const old = this.source;
      old.onended = () => old.disconnect();
      old.stop(now);
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = this.region.loopStart;
    source.loopEnd = this.region.loopEnd;
    source.connect(this.gain);
    source.start(now, offset);
    this.source = source;
    this.anchor = { time: now, offset };
  }
}

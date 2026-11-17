import { clamp } from '../params';
import type { LoopRegion } from '../types';

/** Minimal AudioBuffer shape needed by the pure helpers (real or fake buffers). */
export type PcmBuffer = Pick<
  AudioBuffer,
  'numberOfChannels' | 'length' | 'sampleRate' | 'duration' | 'getChannelData'
>;

export const MIN_LOOP_SEC = 0.1;

export const bufferBytes = (b: Pick<AudioBuffer, 'length' | 'numberOfChannels'>) =>
  b.length * b.numberOfChannels * 4;

export function downmixToMono(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
  if (buffer.numberOfChannels === 1) return buffer;
  const mono = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
  const out = mono.getChannelData(0);
  const n = buffer.numberOfChannels;
  for (let ch = 0; ch < n; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / n;
  }
  return mono;
}

/** Clamp a loop region to 0 <= start < end <= duration with a minimum length. */
export function clampRegion(region: Partial<LoopRegion>, duration: number): LoopRegion {
  const minLen = Math.min(MIN_LOOP_SEC, duration);
  const loopStart = clamp(region.loopStart ?? 0, 0, Math.max(0, duration - minLen));
  const loopEnd = clamp(region.loopEnd ?? duration, loopStart + minLen, duration);
  return { loopStart, loopEnd };
}

/** Max |sample| across channels per bucket. */
export function computePeaks(buffer: PcmBuffer, buckets: number): Float32Array {
  const n = Math.max(1, Math.floor(buckets));
  const peaks = new Float32Array(n);
  const size = buffer.length / n;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let b = 0; b < n; b++) {
      const end = Math.min(buffer.length, Math.floor((b + 1) * size));
      let max = peaks[b];
      for (let i = Math.floor(b * size); i < end; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks[b] = Math.min(1, max);
    }
  }
  return peaks;
}

/**
 * Nearest zero crossing (sign change of the channel sum) to `time` within ±windowSec.
 * Returns `time` unchanged if none is found.
 */
export function findZeroCrossing(buffer: PcmBuffer, time: number, windowSec = 0.01): number {
  const sr = buffer.sampleRate;
  const center = clamp(Math.round(time * sr), 0, buffer.length - 1);
  const radius = Math.round(windowSec * sr);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const at = (i: number) => channels.reduce((sum, d) => sum + d[i], 0);
  const crossesAt = (i: number) => {
    if (i <= 0 || i >= buffer.length) return false;
    const a = at(i - 1);
    const b = at(i);
    return (a <= 0 && b >= 0) || (a >= 0 && b <= 0);
  };
  for (let d = 0; d <= radius; d++) {
    if (crossesAt(center - d)) return (center - d) / sr;
    if (crossesAt(center + d)) return (center + d) / sr;
  }
  return time;
}

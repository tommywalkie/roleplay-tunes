import { vi } from 'vitest';
import { createAudioEngine } from '../src';
import type { AudioEngineOptions, LayerConfig, SoundDescriptor } from '../src';
import {
  encodeFakeAudio,
  FakeAudioContext,
  type FakeAudioContextOptions,
  type FakeAudioNode,
  type FakeAudioParam,
  type FakeGainNode,
} from '../src/testing';

export interface FakeSound extends Partial<SoundDescriptor> {
  seconds: number;
  /** Channels of the "file" before any downmix. */
  fileChannels?: number;
}

export function setup(
  opts: {
    sounds?: Record<string, FakeSound>;
    ctx?: FakeAudioContextOptions;
    engine?: Partial<AudioEngineOptions>;
  } = {},
) {
  const ctx = new FakeAudioContext(opts.ctx);
  const sounds = opts.sounds ?? {
    rain: { seconds: 60 },
    wind: { seconds: 30 },
  };
  const descriptor = (id: string): SoundDescriptor | undefined => {
    const s = sounds[id];
    if (!s) return undefined;
    return {
      id,
      url: `/sounds/${id}.m4a`,
      kind: s.kind ?? 'loop',
      maxInstances: s.maxInstances,
      loopStart: s.loopStart,
      loopEnd: s.loopEnd,
      channels: s.channels,
      gainDb: s.gainDb,
    };
  };
  const fetchSound = vi.fn(async (d: SoundDescriptor) => {
    const s = sounds[d.id];
    return encodeFakeAudio({ seconds: s.seconds, channels: s.fileChannels ?? 2 });
  });
  const engine = createAudioEngine({
    resolveSound: descriptor,
    fetchSound,
    createContext: () => ctx.asAudioContext(),
    rng: () => 0.5,
    autoUnlock: false,
    ...opts.engine,
  });
  return { ctx, engine, sounds, fetchSound };
}

/** Let pending promise chains (fetch → decode → setBuffer) settle. */
export async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

export const layer = (
  id: string,
  soundId: string,
  patch: Partial<LayerConfig> = {},
): LayerConfig => ({
  id,
  soundId,
  volume: 1,
  muted: false,
  mode: { type: 'loop' },
  ...patch,
});

/** Fixed graph nodes created by the engine, in creation order. */
export function graphNodes(ctx: FakeAudioContext) {
  const [mixInput, master, oneshot] = ctx.gains();
  return { mixInput, master, oneshot };
}

/** Follows the single-output chain from a node: source → voice → panner → layer → mute → mix input. */
export function chain(node: FakeAudioNode): FakeAudioNode[] {
  const out: FakeAudioNode[] = [];
  let n: FakeAudioNode | undefined = node;
  while (n && n.outputs.size > 0) {
    n = [...n.outputs][0] as FakeAudioNode;
    out.push(n);
  }
  return out;
}

export function layerNodes(source: FakeAudioNode) {
  const [voice, panner, layerGain, mute, out] = chain(source) as FakeGainNode[];
  return { voice, panner, layerGain, mute, out };
}

/** Final value of a param once all automation has settled. */
export const settled = (p: FakeAudioParam) => p.valueAt(1e6);

/** Advance the audio clock and fake JS timers together (requires vi.useFakeTimers()). */
export async function tick(ctx: FakeAudioContext, sec: number, steps = 1) {
  for (let i = 0; i < steps; i++) {
    ctx.advance(sec / steps);
    await vi.advanceTimersByTimeAsync((sec / steps) * 1000);
  }
}

import type { EngineErrorCode, SoundDescriptor, SoundId } from '../types';
import { BufferCache, MemoryBudgetError } from './buffer-cache';
import { downmixToMono } from './buffer-utils';

export class LoadError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    readonly soundId: SoundId,
    cause?: unknown,
  ) {
    super(`${code}: ${soundId}`, { cause });
  }
}

export const defaultFetchSound = async (d: SoundDescriptor): Promise<ArrayBuffer> => {
  const res = await fetch(d.url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${d.url}`);
  return res.arrayBuffer();
};

/** fetch → decode → (mono downmix) → BufferCache. Dedupes in-flight loads, limits concurrency. */
export class Loader {
  private inFlight = new Map<SoundId, Promise<AudioBuffer>>();
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(
    private getContext: () => BaseAudioContext,
    private resolveSound: (id: SoundId) => SoundDescriptor | undefined,
    private fetchSound: (d: SoundDescriptor) => Promise<ArrayBuffer>,
    readonly cache: BufferCache,
    private concurrency = 2,
  ) {}

  load(id: SoundId): Promise<AudioBuffer> {
    const cached = this.cache.get(id);
    if (cached) return Promise.resolve(cached);
    let p = this.inFlight.get(id);
    if (!p) {
      p = this.withSlot(() => this.fetchAndDecode(id)).finally(() => this.inFlight.delete(id));
      this.inFlight.set(id, p);
    }
    return p;
  }

  private async fetchAndDecode(id: SoundId): Promise<AudioBuffer> {
    const d = this.resolveSound(id);
    if (!d) throw new LoadError('LOAD_FAILED', id, new Error(`Unknown sound "${id}"`));
    let data: ArrayBuffer;
    try {
      data = await this.fetchSound(d);
    } catch (e) {
      throw new LoadError('LOAD_FAILED', id, e);
    }
    const ctx = this.getContext();
    let buffer: AudioBuffer;
    try {
      // decodeAudioData detaches `data`: never reuse it.
      buffer = await ctx.decodeAudioData(data);
    } catch (e) {
      throw new LoadError('DECODE_FAILED', id, e);
    }
    if (d.channels === 1) buffer = downmixToMono(ctx, buffer);
    try {
      this.cache.set(id, buffer);
    } catch (e) {
      if (e instanceof MemoryBudgetError) throw new LoadError('MEMORY_BUDGET', id, e);
      throw e;
    }
    return buffer;
  }

  private withSlot<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.active--;
            this.queue.shift()?.();
          });
      };
      if (this.active < this.concurrency) run();
      else this.queue.push(run);
    });
  }
}

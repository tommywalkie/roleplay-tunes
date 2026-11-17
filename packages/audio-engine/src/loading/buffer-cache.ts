import type { SoundId } from '../types';
import { bufferBytes } from './buffer-utils';

export class MemoryBudgetError extends Error {
  constructor(readonly soundId: SoundId) {
    super(`Decoded audio for "${soundId}" does not fit in the memory budget`);
  }
}

/** Decoded buffers with an LRU + byte budget. Retained (in-use) buffers are never evicted. */
export class BufferCache {
  // Map iteration order = LRU order (oldest first).
  private entries = new Map<SoundId, AudioBuffer>();
  private refs = new Map<SoundId, number>();
  usedBytes = 0;

  constructor(
    readonly budgetBytes: number,
    private onChange: () => void = () => {},
  ) {}

  get(id: SoundId): AudioBuffer | undefined {
    const b = this.entries.get(id);
    if (b) {
      this.entries.delete(id);
      this.entries.set(id, b);
    }
    return b;
  }

  /** Throws MemoryBudgetError if the buffer cannot fit even after evicting unused entries. */
  set(id: SoundId, buffer: AudioBuffer) {
    this.delete(id);
    const size = bufferBytes(buffer);
    for (const [key] of this.entries) {
      if (this.usedBytes + size <= this.budgetBytes) break;
      if (!this.refs.get(key)) this.delete(key);
    }
    if (this.usedBytes + size > this.budgetBytes) throw new MemoryBudgetError(id);
    this.entries.set(id, buffer);
    this.usedBytes += size;
    this.onChange();
  }

  has(id: SoundId) {
    return this.entries.has(id);
  }

  retain(id: SoundId) {
    this.refs.set(id, (this.refs.get(id) ?? 0) + 1);
  }

  release(id: SoundId) {
    const n = (this.refs.get(id) ?? 0) - 1;
    if (n > 0) this.refs.set(id, n);
    else this.refs.delete(id);
  }

  isRetained(id: SoundId) {
    return (this.refs.get(id) ?? 0) > 0;
  }

  delete(id: SoundId) {
    const b = this.entries.get(id);
    if (!b) return;
    this.entries.delete(id);
    this.usedBytes -= bufferBytes(b);
    this.onChange();
  }

  clear() {
    this.entries.clear();
    this.refs.clear();
    this.usedBytes = 0;
    this.onChange();
  }
}

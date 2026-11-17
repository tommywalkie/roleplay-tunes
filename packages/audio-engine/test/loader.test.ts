import { describe, expect, it } from 'vitest';
import { BufferCache } from '../src/loading/buffer-cache';
import { Loader, LoadError } from '../src/loading/loader';
import type { SoundDescriptor } from '../src';
import { encodeFakeAudio, FakeAudioBuffer, FakeAudioContext } from '../src/testing';
import { flush } from './helpers';

const MB = 1024 * 1024;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function makeLoader(
  opts: { budget?: number; channels?: 1 | 2; fetch?: () => Promise<ArrayBuffer> } = {},
) {
  const ctx = new FakeAudioContext();
  const cache = new BufferCache(opts.budget ?? 400 * MB);
  let fetches = 0;
  const loader = new Loader(
    () => ctx.asAudioContext(),
    (id) =>
      id === 'missing'
        ? undefined
        : ({ id, url: id, kind: 'loop', channels: opts.channels } as SoundDescriptor),
    async () => {
      fetches++;
      return opts.fetch ? opts.fetch() : encodeFakeAudio({ seconds: 10 });
    },
    cache,
  );
  return { ctx, cache, loader, fetches: () => fetches };
}

const bytes = (seconds: number, channels = 2) => seconds * 48000 * channels * 4;

describe('Loader', () => {
  it('dedupes concurrent loads and serves cached buffers', async () => {
    const { loader, ctx, fetches } = makeLoader();
    const [a, b] = await Promise.all([loader.load('rain'), loader.load('rain')]);
    expect(a).toBe(b);
    expect(await loader.load('rain')).toBe(a);
    expect(fetches()).toBe(1);
    expect(ctx.decodeCount).toBe(1);
  });

  it('runs at most 2 fetch+decode tasks at a time', async () => {
    const pending: ReturnType<typeof deferred<ArrayBuffer>>[] = [];
    const { loader, fetches } = makeLoader({
      fetch: () => {
        const d = deferred<ArrayBuffer>();
        pending.push(d);
        return d.promise;
      },
    });
    const all = Promise.all(['a', 'b', 'c'].map((id) => loader.load(id)));
    await flush();
    expect(fetches()).toBe(2);
    pending[0].resolve(encodeFakeAudio({ seconds: 1 }));
    await flush();
    expect(fetches()).toBe(3);
    pending[1].resolve(encodeFakeAudio({ seconds: 1 }));
    pending[2].resolve(encodeFakeAudio({ seconds: 1 }));
    await all;
  });

  it('downmixes to mono when the descriptor says channels: 1', async () => {
    const { loader, cache } = makeLoader({ channels: 1 });
    const buffer = await loader.load('wind');
    expect(buffer.numberOfChannels).toBe(1);
    expect(cache.usedBytes).toBe(bytes(10, 1));
  });

  it('wraps errors with a code', async () => {
    const { loader } = makeLoader();
    await expect(loader.load('missing')).rejects.toMatchObject({ code: 'LOAD_FAILED' });
    const failing = makeLoader({ fetch: () => Promise.reject(new Error('offline')) });
    const err = await failing.loader.load('rain').catch((e: LoadError) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect((err as LoadError).code).toBe('LOAD_FAILED');
  });
});

describe('BufferCache', () => {
  const buf = (seconds: number) =>
    new FakeAudioBuffer({
      numberOfChannels: 2,
      length: seconds * 48000,
      sampleRate: 48000,
    }) as unknown as AudioBuffer;

  it('evicts least-recently-used unretained buffers to fit the budget', () => {
    const cache = new BufferCache(bytes(25));
    cache.set('a', buf(10));
    cache.set('b', buf(10));
    cache.get('a'); // a is now most recent
    cache.set('c', buf(10));
    expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([true, false, true]);
  });

  it('never evicts retained buffers and throws when nothing can be freed', async () => {
    const cache = new BufferCache(bytes(25));
    cache.set('a', buf(10));
    cache.set('b', buf(10));
    cache.retain('a');
    cache.retain('b');
    expect(() => cache.set('c', buf(10))).toThrow(/memory budget/);
    expect(cache.usedBytes).toBe(bytes(20));
    cache.release('b');
    cache.set('c', buf(10));
    expect([cache.has('a'), cache.has('b'), cache.has('c')]).toEqual([true, false, true]);
  });

  it('surfaces MEMORY_BUDGET through the loader', async () => {
    const { loader } = makeLoader({ budget: bytes(5) });
    await expect(loader.load('rain')).rejects.toMatchObject({ code: 'MEMORY_BUDGET' });
  });
});

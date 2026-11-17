import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaSessionLike } from '../src';
import { flush, layer, setup } from './helpers';

afterEach(() => {
  vi.useRealTimers();
});

function fakeMediaSession() {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const api: MediaSessionLike & { handlers: typeof handlers } = {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler(action, handler) {
      handlers.set(action, handler);
    },
  };
  const trigger = (action: MediaSessionAction) =>
    handlers.get(action)?.({ action } as MediaSessionActionDetails);
  return { api, trigger };
}

describe('Media Session', () => {
  it('mirrors the mix name and playback state', async () => {
    const { api } = fakeMediaSession();
    const { engine } = setup({ engine: { mediaSession: { api, artist: 'GM' } } });
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Tavern', layers: [layer('l1', 'rain')] });
    await flush();
    expect(api.metadata).toMatchObject({ title: 'Tavern', artist: 'GM' });
    expect(api.playbackState).toBe('playing');

    vi.useFakeTimers();
    const paused = engine.pause();
    await vi.advanceTimersByTimeAsync(200);
    await paused;
    await flush();
    expect(api.playbackState).toBe('paused');

    engine.stop();
    await flush();
    expect(api.metadata).toBeNull();
    expect(api.playbackState).toBe('none');
  });

  it('routes OS actions to the engine and emits next/previous', async () => {
    vi.useFakeTimers();
    const { api, trigger } = fakeMediaSession();
    const { engine, ctx } = setup({ engine: { mediaSession: { api } } });
    await engine.unlock();
    engine.playMix({ id: 'm', name: 'Tavern', layers: [] });
    const actions = vi.fn();
    engine.on('mediaSessionAction', actions);

    trigger('pause');
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.state).toBe('suspended');
    trigger('play');
    await flush();
    expect(engine.getSnapshot().status).toBe('playing');
    trigger('nexttrack');
    trigger('previoustrack');
    expect(actions.mock.calls).toEqual([[{ action: 'nexttrack' }], [{ action: 'previoustrack' }]]);
    trigger('stop');
    expect(engine.getSnapshot().mix).toBeNull();
  });

  it('clears handlers on dispose and can be disabled', async () => {
    const { api } = fakeMediaSession();
    const { engine } = setup({ engine: { mediaSession: { api } } });
    expect(api.handlers.get('play')).toBeTypeOf('function');
    await engine.dispose();
    expect(api.handlers.get('play')).toBeNull();

    const disabled = fakeMediaSession();
    const spy = vi.spyOn(disabled.api, 'setActionHandler');
    setup({ engine: { mediaSession: false } });
    expect(spy).not.toHaveBeenCalled();
  });
});

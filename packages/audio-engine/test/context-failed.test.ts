import { describe, expect, it } from 'vitest';
import type { EngineEvents } from '../src';
import { ContextFailedError } from '../src/engine';
import { flush, layer, setup } from './helpers';

/**
 * Browsers without Web Audio (Playwright's Windows WebKit, microsoft/playwright#14105)
 * throw inside the AudioContext constructor. The engine must report CONTEXT_FAILED once
 * and stay a clean no-op afterwards — never leak an uncaught error into a UI handler.
 */
describe('AudioContext construction failure', () => {
  it('emits CONTEXT_FAILED once and keeps the store untouched', () => {
    const errors: EngineEvents['error'][] = [];
    const { engine } = setup({
      sounds: { rain: { seconds: 10 } },
      engine: {
        createContext: () => {
          throw new ReferenceError('AudioContext is not defined');
        },
      },
    });
    engine.on('error', (e) => errors.push(e));

    expect(() => engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] })).toThrow(
      ContextFailedError,
    );
    expect(engine.getSnapshot().status).toBe('uninitialized');
    expect(engine.getSnapshot().mix).toBeNull();
    expect(errors.map((e) => e.code)).toEqual(['CONTEXT_FAILED']);
  });

  it('unlock() resolves instead of rejecting, and later calls stay clean no-ops', async () => {
    const errors: EngineEvents['error'][] = [];
    const { engine } = setup({
      sounds: { rain: { seconds: 10 } },
      engine: {
        createContext: () => {
          throw new ReferenceError('AudioContext is not defined');
        },
      },
    });
    engine.on('error', (e) => errors.push(e));

    // Called fire-and-forget from gesture handlers: must never reject.
    await expect(engine.unlock()).resolves.toBeUndefined();

    // The same typed error is rethrown — no new event, no store change.
    expect(() => engine.playMix({ id: 'm', name: 'Rainy', layers: [layer('l1', 'rain')] })).toThrow(
      ContextFailedError,
    );
    expect(() => engine.playOneshot('rain')).toThrow(ContextFailedError);
    await flush();
    expect(errors.map((e) => e.code)).toEqual(['CONTEXT_FAILED']);
    expect(engine.getSnapshot().mix).toBeNull();
    expect(engine.getSnapshot().activeOneshotCount).toBe(0);
  });
});

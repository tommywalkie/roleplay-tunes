// iOS does not treat touchstart / pointerdown as user activation.
const GESTURE_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/** Calls `unlock` on each user gesture until it reports success. Returns a remover. */
export function installGestureUnlock(target: EventTarget, unlock: () => Promise<boolean>) {
  let removed = false;
  const remove = () => {
    removed = true;
    for (const type of GESTURE_EVENTS) target.removeEventListener(type, handler, true);
  };
  const handler = () => {
    void unlock().then((ok) => {
      if (ok && !removed) remove();
    });
  };
  for (const type of GESTURE_EVENTS) target.addEventListener(type, handler, true);
  return remove;
}

/**
 * Must run inside the gesture handler, before `ctx.resume()` settles.
 * - `navigator.audioSession.type = 'playback'` (Safari 16.4+): plays through the iOS silent switch.
 * - 1-sample silent buffer: unlocks older iOS WebKit.
 */
export function primeContext(ctx: AudioContext) {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const session = (nav as { audioSession?: { type: string } } | undefined)?.audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      // Best effort.
    }
  }
  const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => source.disconnect();
  source.start(0);
}

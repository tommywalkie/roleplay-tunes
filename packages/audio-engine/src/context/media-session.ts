import type { MediaSessionLike } from '../types';

export interface MediaSessionState {
  title: string | null;
  playbackState: MediaSessionPlaybackState;
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  stop(): void;
  nexttrack(): void;
  previoustrack(): void;
}

const ACTIONS = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack'] as const;

/**
 * Mirrors the engine state into the Media Session API (OS media controls / lock screen).
 * Note: iOS only shows controls for media elements; with v1's direct Web Audio output this is
 * mostly visible on desktop / Android.
 */
export class MediaSessionController {
  private last: MediaSessionState = { title: null, playbackState: 'none' };

  constructor(
    private api: MediaSessionLike,
    private meta: { artist: string; artwork?: MediaImage[] },
    handlers: MediaSessionHandlers,
  ) {
    for (const action of ACTIONS) {
      try {
        api.setActionHandler(action, () => handlers[action]());
      } catch {
        // Unsupported action on this browser.
      }
    }
  }

  sync(state: MediaSessionState) {
    if (state.title !== this.last.title) {
      this.api.metadata = state.title
        ? createMetadata({
            title: state.title,
            artist: this.meta.artist,
            artwork: this.meta.artwork,
          })
        : null;
    }
    if (state.playbackState !== this.last.playbackState) {
      this.api.playbackState = state.playbackState;
    }
    this.last = state;
  }

  dispose() {
    for (const action of ACTIONS) {
      try {
        this.api.setActionHandler(action, null);
      } catch {
        // Ignore.
      }
    }
    this.api.metadata = null;
    this.api.playbackState = 'none';
  }
}

function createMetadata(init: MediaMetadataInit): MediaMetadata {
  return typeof MediaMetadata === 'function'
    ? new MediaMetadata(init)
    : (init as unknown as MediaMetadata);
}

export function defaultMediaSession(): MediaSessionLike | undefined {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : undefined;
}

import {
  createAudioEngine,
  type AudioEngine,
  type EngineSnapshot,
  type LayerConfig,
  type LayerMode,
  type SoundDescriptor,
} from '@dnd/audio-engine';
import type { Mix, PlayMode, Sound } from '@dnd/shared';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/** Id of the engine mix that holds sounds started one by one, outside any saved mix. */
export const LOOSE_MIX_ID = 'loose';

interface LayerSettings {
  mode: PlayMode;
  volume: number;
  intervalMinSec: number;
  intervalMaxSec: number;
  volumeVariation: number;
}

export function toDescriptor(sound: Sound): SoundDescriptor {
  return {
    id: sound.id,
    url: sound.audioUrl,
    kind: sound.defaultMode === 'oneshot' ? 'oneshot' : 'loop',
    loopStart: sound.loopStartSec ?? undefined,
    loopEnd: sound.loopEndSec ?? undefined,
    defaultVolume: sound.defaultVolume,
  };
}

function toLayerMode(s: LayerSettings): LayerMode {
  if (s.mode === 'recurring') {
    return {
      type: 'recurring',
      minInterval: Math.min(s.intervalMinSec, s.intervalMaxSec),
      maxInterval: Math.max(s.intervalMinSec, s.intervalMaxSec),
      volumeJitter: [1 - s.volumeVariation, 1],
    };
  }
  return { type: 'loop' };
}

function toLayer(id: string, soundId: string, s: LayerSettings): LayerConfig {
  return { id, soundId, volume: s.volume, muted: false, mode: toLayerMode(s) };
}

const soundSettings = (sound: Sound): LayerSettings => ({
  mode: sound.defaultMode,
  volume: sound.defaultVolume,
  intervalMinSec: sound.intervalMinSec,
  intervalMaxSec: sound.intervalMaxSec,
  volumeVariation: sound.volumeVariation,
});

export interface Player {
  snapshot: EngineSnapshot;
  /** Starts the mix, replacing what plays. Tapping the mix that plays stops it. */
  toggleMix: (mix: Mix) => void;
  /** One-shot sounds fire on every tap. Others switch on and off, on top of what plays. */
  toggleSound: (sound: Sound) => void;
  /** Stops every layer and every one-shot. */
  stopAll: () => void;
  togglePause: () => void;
  setMasterVolume: (v: number) => void;
  setEffectsVolume: (v: number) => void;
  setLayerVolume: (layerId: string, v: number) => void;
  setLayerMuted: (layerId: string, muted: boolean) => void;
  removeLayer: (layerId: string) => void;
  isMixPlaying: (mixId: string) => boolean;
  isSoundPlaying: (soundId: string) => boolean;
  /** Subscribe to sounds that failed to load. */
  onLoadError: (cb: (soundId: string | undefined) => void) => () => void;
}

/**
 * Wraps the audio engine with the board's rules. The engine plays one set of layers at a
 * time plus one-shots; this decides what a tap on a tile means.
 */
export function createPlayer(engine: AudioEngine, snapshot: EngineSnapshot): Player {
  const layers = () => engine.getSnapshot().mix?.layers ?? [];
  const wake = () => {
    if (engine.getSnapshot().status === 'paused') void engine.resume();
  };
  const stopIfEmpty = () => {
    if (layers().length === 0) engine.stop();
  };

  return {
    snapshot,
    toggleMix(mix) {
      if (engine.getSnapshot().mix?.id === mix.id) {
        engine.stop();
        return;
      }
      wake();
      const playable = mix.items.filter((i) => i.mode !== 'oneshot');
      engine.playMix({
        id: mix.id,
        name: mix.name,
        layers: playable.map((i) => toLayer(`item:${i.id}`, i.soundId, i)),
      });
      // A "once" item has no place in a looping bed: it is heard once, as the mix starts.
      for (const item of mix.items) {
        if (item.mode === 'oneshot') engine.playOneshot(item.soundId, { volume: item.volume });
      }
    },
    toggleSound(sound) {
      wake();
      if (sound.defaultMode === 'oneshot') {
        engine.playOneshot(sound.id);
        return;
      }
      const playing = layers().filter((l) => l.soundId === sound.id);
      if (playing.length > 0) {
        for (const layer of playing) engine.removeLayer(layer.id);
        stopIfEmpty();
        return;
      }
      const layer = toLayer(`sound:${sound.id}`, sound.id, soundSettings(sound));
      if (engine.getSnapshot().mix) engine.addLayer(layer);
      else engine.playMix({ id: LOOSE_MIX_ID, name: '', layers: [layer] });
    },
    stopAll() {
      engine.stop();
      engine.stopAllOneshots(0.15);
    },
    togglePause() {
      if (engine.getSnapshot().status === 'paused') void engine.resume();
      else void engine.pause();
    },
    setMasterVolume: (v) => engine.setMasterVolume(v),
    setEffectsVolume: (v) => engine.setEffectsVolume(v),
    setLayerVolume: (layerId, volume) => engine.updateLayer(layerId, { volume }),
    setLayerMuted: (layerId, muted) => engine.updateLayer(layerId, { muted }),
    removeLayer(layerId) {
      engine.removeLayer(layerId);
      stopIfEmpty();
    },
    isMixPlaying: (mixId) => snapshot.mix?.id === mixId,
    isSoundPlaying: (soundId) =>
      (snapshot.mix?.layers.some((l) => l.soundId === soundId) ?? false) ||
      snapshot.activeOneshots.some((o) => o.soundId === soundId),
    onLoadError: (cb) =>
      engine.on('error', (e) => {
        if (e.code === 'LOAD_FAILED' || e.code === 'DECODE_FAILED') cb(e.soundId);
      }),
  };
}

// One engine for the whole visit: an AudioContext is expensive, and React may mount twice
// in development. The sound lookup is swapped in by the provider.
let sharedEngine: AudioEngine | null = null;
let lookup: (id: string) => Sound | undefined = () => undefined;

function getSharedEngine(): AudioEngine {
  sharedEngine ??= createAudioEngine({
    resolveSound: (id) => {
      const sound = lookup(id);
      return sound ? toDescriptor(sound) : undefined;
    },
    mediaSession: { artist: 'Ambiance' },
  });
  return sharedEngine;
}

const PlayerContext = createContext<Player | null>(null);

export function PlayerProvider({
  sounds,
  engine: injected,
  children,
}: {
  sounds: Sound[];
  /** Tests pass their own engine. */
  engine?: AudioEngine;
  children: ReactNode;
}) {
  const engine = injected ?? getSharedEngine();
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  if (!injected) lookup = (id) => byIdRef.current.get(id);

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const player = useMemo(() => createPlayer(engine, snapshot), [engine, snapshot]);

  // Edited loop points or a deleted sound must reach layers that already play.
  const previous = useRef(byId);
  useEffect(() => {
    const before = previous.current;
    previous.current = byId;
    for (const layer of engine.getSnapshot().mix?.layers ?? []) {
      const now = byId.get(layer.soundId);
      if (!now) engine.removeLayer(layer.id);
      else if (now !== before.get(layer.soundId)) engine.refreshSound(layer.soundId);
    }
  }, [byId, engine]);

  // Signing out unmounts the board: nothing may keep playing behind the sign-in page.
  useEffect(
    () => () => {
      engine.stop({ fadeSec: 0.1 });
      engine.stopAllOneshots(0.1);
    },
    [engine],
  );

  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer must be used inside PlayerProvider');
  return player;
}

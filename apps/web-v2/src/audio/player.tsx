import {
  createAudioEngine,
  type AudioEngine,
  type EngineSnapshot,
  type LayerConfig,
  type LayerMode,
  type LayerState,
  type LoopConfig,
  type LoopPreviewHandle,
  type SoundDescriptor,
} from '@dnd/audio-engine';
import {
  DEFAULT_INTERVAL_MAX_SEC,
  DEFAULT_INTERVAL_MIN_SEC,
  MIN_INTERVAL_SEC,
  resolveLoopSettings,
  type LoopSettings,
  type Mix,
  type MixItem,
  type MixItemInput,
  type PlayMode,
  type Sound,
} from '@dnd/shared';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  /** The loop markers this layer plays with (the sound's own, or a mix item's override). */
  loop: LoopSettings;
}

/** A sound's own loop settings, resolved against its duration. */
export const soundLoop = (sound: Sound): LoopSettings =>
  resolveLoopSettings({
    durationSec: sound.durationSec,
    trackStartSec: sound.trackStartSec,
    trackEndSec: sound.trackEndSec,
    loopStartSec: sound.loopStartSec,
    loopEndSec: sound.loopEndSec,
    crossfadeSec: sound.crossfadeSec,
  });

/** A mix item's loop settings: its own overrides over the sound's defaults. */
export const itemLoop = (
  sound: Sound,
  item: Pick<
    MixItem,
    'trackStartSec' | 'trackEndSec' | 'loopStartSec' | 'loopEndSec' | 'crossfadeSec'
  >,
): LoopSettings =>
  resolveLoopSettings({
    durationSec: sound.durationSec,
    trackStartSec: item.trackStartSec ?? sound.trackStartSec,
    trackEndSec: item.trackEndSec ?? sound.trackEndSec,
    loopStartSec: item.loopStartSec ?? sound.loopStartSec,
    loopEndSec: item.loopEndSec ?? sound.loopEndSec,
    crossfadeSec: item.crossfadeSec ?? sound.crossfadeSec,
  });

/** The loop settings a playing layer uses now, falling back to the sound's own. */
export const layerLoop = (sound: Sound, loop: Partial<LoopConfig> | undefined): LoopSettings =>
  resolveLoopSettings({
    ...soundLoop(sound),
    durationSec: sound.durationSec,
    ...(loop?.trackStart !== undefined ? { trackStartSec: loop.trackStart } : {}),
    ...(loop?.trackEnd !== undefined ? { trackEndSec: loop.trackEnd } : {}),
    ...(loop?.loopStart !== undefined ? { loopStartSec: loop.loopStart } : {}),
    ...(loop?.loopEnd !== undefined ? { loopEndSec: loop.loopEnd } : {}),
    ...(loop?.crossfadeSec !== undefined ? { crossfadeSec: loop.crossfadeSec } : {}),
  });

function toEngineLoop(loop: LoopSettings): Partial<LoopConfig> {
  return {
    trackStart: loop.trackStartSec,
    trackEnd: loop.trackEndSec,
    loopStart: loop.loopStartSec,
    loopEnd: loop.loopEndSec,
    mode: loop.crossfadeSec > 0 ? 'crossfade' : 'gapless',
    crossfadeSec: loop.crossfadeSec,
  };
}

export function toDescriptor(sound: Sound): SoundDescriptor {
  return {
    id: sound.id,
    url: sound.audioUrl,
    kind: sound.defaultMode === 'oneshot' ? 'oneshot' : 'loop',
    loopStart: sound.loopStartSec ?? undefined,
    loopEnd: sound.loopEndSec ?? undefined,
    trackStart: sound.trackStartSec ?? undefined,
    trackEnd: sound.trackEndSec ?? undefined,
    loopMode: (sound.crossfadeSec ?? 0) > 0 ? 'crossfade' : 'gapless',
    crossfadeSec: sound.crossfadeSec ?? undefined,
    defaultVolume: sound.defaultVolume,
  };
}

function toLayerMode(s: LayerSettings): LayerMode {
  const loop = toEngineLoop(s.loop);
  if (s.mode === 'recurring') {
    return {
      type: 'recurring',
      minInterval: Math.min(s.intervalMinSec, s.intervalMaxSec),
      maxInterval: Math.max(s.intervalMinSec, s.intervalMaxSec),
      volumeJitter: [1 - s.volumeVariation, 1],
      loop,
    };
  }
  // The engine starts loops at a random point by default; here a loop always starts at its beginning.
  return { type: 'loop', randomStart: false, loop };
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
  loop: soundLoop(sound),
});

/**
 * What the player plays, as the items of a new mix: each sound once, with the mode,
 * volume and pauses it plays with right now. One-shots in flight are not part of it.
 */
export function layersToMixItems(layers: LayerState[]): Required<MixItemInput>[] {
  const seen = new Set<string>();
  return layers.flatMap((layer) => {
    const mode = layer.mode;
    // A playlist on top is not part of the bed: it stays a playlist of its own.
    if (mode.type === 'sequence' || seen.has(layer.soundId)) return [];
    seen.add(layer.soundId);
    const recurring = mode.type === 'recurring';
    const loop = mode.loop ?? {};
    return [
      {
        soundId: layer.soundId,
        mode: recurring ? 'recurring' : 'loop',
        volume: layer.volume,
        intervalMinSec: recurring
          ? Math.max(MIN_INTERVAL_SEC, mode.minInterval)
          : DEFAULT_INTERVAL_MIN_SEC,
        intervalMaxSec: recurring
          ? Math.max(MIN_INTERVAL_SEC, mode.maxInterval)
          : DEFAULT_INTERVAL_MAX_SEC,
        volumeVariation: recurring ? 1 - (mode.volumeJitter?.[0] ?? 1) : 0,
        trackStartSec: loop.trackStart ?? null,
        trackEndSec: loop.trackEnd ?? null,
        loopStartSec: loop.loopStart ?? null,
        loopEndSec: loop.loopEnd ?? null,
        crossfadeSec: loop.crossfadeSec ?? null,
      },
    ];
  });
}

/** A way to play a sound, chosen at play time rather than saved on the sound. */
export type SoundPlay =
  | { mode: 'oneshot' }
  | { mode: 'loop' }
  | { mode: 'recurring'; intervalMinSec: number; intervalMaxSec: number };

/** How the sound plays when started with no other choice: its own saved settings. */
export const defaultPlay = (sound: Sound): SoundPlay =>
  sound.defaultMode === 'recurring'
    ? {
        mode: 'recurring',
        intervalMinSec: sound.intervalMinSec,
        intervalMaxSec: sound.intervalMaxSec,
      }
    : { mode: sound.defaultMode };

const NO_MIXES: Mix[] = [];

/** Layer id of a playlist held by a mix: plays and stops with that mix. */
export const mixPlaylistLayerId = (mixId: string, playlistId: string) =>
  `in-mix:${mixId}:${playlistId}`;

/** The playlist a sequence layer plays, from its layer id (on top or inside a mix). */
export const playlistIdOfLayer = (layerId: string) => layerId.slice(layerId.lastIndexOf(':') + 1);

/** Layer id of a playlist playing on top of the mix. One at a time. */
export const PLAYLIST_LAYER_PREFIX = 'playlist:';
export const playlistLayerId = (playlistId: string) => `${PLAYLIST_LAYER_PREFIX}${playlistId}`;
export const isPlaylistLayer = (layerId: string) => layerId.startsWith(PLAYLIST_LAYER_PREFIX);

/** A layer's settings without what the engine adds to its state. */
function layerConfig(state: LayerState): LayerConfig {
  const config: LayerConfig & Partial<Pick<LayerState, 'load' | 'current'>> = { ...state };
  delete config.load;
  delete config.current;
  return config;
}

export interface Player {
  snapshot: EngineSnapshot;
  /**
   * Starts the mix, replacing what plays. Tapping the mix that plays stops it. A playlist
   * playing on top goes on through both. For a playlist, see `togglePlaylist`.
   */
  toggleMix: (mix: Mix) => void;
  /**
   * Plays a playlist on top of what plays, one sound after another, starting over after the
   * last. Another playlist playing stops; tapping the playing one stops it.
   */
  togglePlaylist: (playlist: Mix) => void;
  /** Jumps a playing playlist (on top or inside a mix) to its next (1) or previous (-1) sound. */
  skipPlaylist: (layerId: string, delta: number) => void;
  /** One-shot sounds fire on every tap. Others switch on and off, on top of what plays. */
  toggleSound: (sound: Sound) => void;
  /**
   * Plays a sound the way the user picked, whatever its own mode. If it already plays,
   * on its own or in a mix, it starts over in the new way instead of doubling.
   */
  playSoundAs: (sound: Sound, play: SoundPlay) => void;
  /**
   * Changes how a layer that plays repeats: as a loop, or with other random pauses. It
   * keeps its place, its volume and its mute. Switching between loop and pauses restarts
   * the sound; new pauses apply from the next play.
   */
  setLayerPlay: (
    layerId: string,
    sound: Sound,
    play: Exclude<SoundPlay, { mode: 'oneshot' }>,
  ) => void;
  /**
   * Changes the loop markers of a playing layer, live. Nothing is saved: the sound, its mix
   * and its scenes keep their own settings, and the change is gone once the layer stops.
   */
  setLayerLoop: (layerId: string, loop: LoopSettings) => void;
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
  /**
   * Plays a sound's test sequence in the loop editor (track start → loop, with its loop mode),
   * pausing the main player while it runs. Returns the preview handle.
   */
  previewLoopTest: (sound: Sound, loop: LoopSettings) => LoopPreviewHandle;
  /** Max |sample| per bucket, for the loop editor's waveform. */
  waveformPeaks: (soundId: string, buckets: number) => Promise<Float32Array>;
  /** Nearest zero crossing to `time`, for snapping loop markers. */
  snapToZero: (soundId: string, time: number) => Promise<number>;
  /** Subscribe to sounds that failed to load. */
  onLoadError: (cb: (soundId: string | undefined) => void) => () => void;
}

/**
 * Wraps the audio engine with the board's rules. The engine plays one set of layers at a
 * time plus one-shots; this decides what a tap on a tile means.
 */
export function createPlayer(
  engine: AudioEngine,
  snapshot: EngineSnapshot,
  getSound: (id: string) => Sound | undefined = (id) => lookup(id),
  /** For the playlists a mix holds. */
  getMix: (id: string) => Mix | undefined = () => undefined,
): Player {
  const layers = () => engine.getSnapshot().mix?.layers ?? [];
  const wake = () => {
    if (engine.getSnapshot().status === 'paused') void engine.resume();
  };
  const stopIfEmpty = () => {
    if (layers().length === 0) engine.stop();
  };
  const startLayer = (sound: Sound, settings: LayerSettings) => {
    const layer = toLayer(`sound:${sound.id}`, sound.id, settings);
    if (engine.getSnapshot().mix) engine.addLayer(layer);
    else engine.playMix({ id: LOOSE_MIX_ID, name: '', layers: [layer] });
  };
  /** A mix item's settings: its own loop markers over the sound's defaults. */
  const itemSettings = (item: MixItem): LayerSettings => {
    const sound = getSound(item.soundId);
    return {
      mode: item.mode,
      volume: item.volume,
      intervalMinSec: item.intervalMinSec,
      intervalMaxSec: item.intervalMaxSec,
      volumeVariation: item.volumeVariation,
      loop: sound
        ? itemLoop(sound, item)
        : resolveLoopSettings({
            durationSec: 0,
            trackStartSec: item.trackStartSec,
            trackEndSec: item.trackEndSec,
            loopStartSec: item.loopStartSec,
            loopEndSec: item.loopEndSec,
            crossfadeSec: item.crossfadeSec,
          }),
    };
  };

  /** Layers playing this sound on its own or in the mix; a playlist holding it is not one. */
  const soundLayers = (soundId: string) =>
    layers().filter((l) => l.soundId === soundId && l.mode.type !== 'sequence');
  /**
   * The playlist's sounds as one sequence layer, each with its own volume and track range;
   * the hand-over between them is the playlist's own crossfade.
   */
  const playlistLayer = (
    playlist: Mix,
    id = playlistLayerId(playlist.id),
    volume = 1,
  ): LayerConfig | null => {
    const items = playlist.items.flatMap((item) => {
      const sound = getSound(item.soundId);
      if (!sound) return [];
      const range = itemLoop(sound, item);
      return [
        {
          soundId: item.soundId,
          volume: item.volume,
          loop: { trackStart: range.trackStartSec, trackEnd: range.trackEndSec },
        },
      ];
    });
    if (items.length === 0) return null;
    return {
      id,
      soundId: items[0].soundId,
      volume,
      muted: false,
      mode: { type: 'sequence', items, crossfadeSec: playlist.crossfadeSec },
    };
  };
  /** The playlists a mix holds, each as one more layer of it. */
  const heldPlaylists = (mix: Mix): LayerConfig[] =>
    mix.playlists.flatMap((entry) => {
      const playlist = getMix(entry.playlistId);
      const layer =
        playlist && playlistLayer(playlist, mixPlaylistLayerId(mix.id, playlist.id), entry.volume);
      return layer ? [layer] : [];
    });
  /** The playlist playing on top, carried through a change of mix. */
  const carriedPlaylist = (): LayerConfig[] =>
    layers()
      .filter((l) => isPlaylistLayer(l.id))
      .map(layerConfig);

  const player: Player = {
    snapshot,
    toggleMix(mix) {
      if (mix.kind === 'playlist') {
        player.togglePlaylist(mix);
        return;
      }
      const keep = carriedPlaylist();
      if (engine.getSnapshot().mix?.id === mix.id) {
        if (keep.length > 0) engine.playMix({ id: LOOSE_MIX_ID, name: '', layers: keep });
        else engine.stop();
        return;
      }
      wake();
      const playable = mix.items.filter((i) => i.mode !== 'oneshot');
      engine.playMix({
        id: mix.id,
        name: mix.name,
        layers: [
          ...playable.map((i) => toLayer(`item:${i.id}`, i.soundId, itemSettings(i))),
          ...heldPlaylists(mix),
          ...keep,
        ],
      });
      // A "once" item has no place in a looping bed: it is heard once, as the mix starts.
      for (const item of mix.items) {
        if (item.mode === 'oneshot') {
          const sound = getSound(item.soundId);
          const loop = sound ? itemLoop(sound, item) : null;
          engine.playOneshot(item.soundId, {
            volume: item.volume,
            ...(loop ? { trackStart: loop.trackStartSec, trackEnd: loop.trackEndSec } : {}),
          });
        }
      }
    },
    toggleSound(sound) {
      wake();
      if (sound.defaultMode === 'oneshot') {
        engine.playOneshot(sound.id);
        return;
      }
      const playing = soundLayers(sound.id);
      if (playing.length > 0) {
        for (const layer of playing) engine.removeLayer(layer.id);
        stopIfEmpty();
        return;
      }
      startLayer(sound, soundSettings(sound));
    },
    playSoundAs(sound, play) {
      wake();
      if (play.mode === 'oneshot') {
        engine.playOneshot(sound.id);
        return;
      }
      const replaced = soundLayers(sound.id);
      for (const layer of replaced) engine.removeLayer(layer.id);
      startLayer(sound, {
        ...soundSettings(sound),
        // A sound that already plays keeps the volume it was given in the player.
        volume: replaced[0]?.volume ?? sound.defaultVolume,
        mode: play.mode,
        ...(play.mode === 'recurring'
          ? { intervalMinSec: play.intervalMinSec, intervalMaxSec: play.intervalMaxSec }
          : {}),
      });
    },
    setLayerPlay(layerId, sound, play) {
      const current = layers().find((l) => l.id === layerId);
      if (!current || current.mode.type === 'sequence') return;
      const jitter: [number, number] =
        current.mode.type === 'recurring' && current.mode.volumeJitter
          ? current.mode.volumeJitter
          : [1 - sound.volumeVariation, 1];
      // The loop markers the layer plays with stay whatever they were.
      const loop = current.mode.loop;
      wake();
      engine.updateLayer(layerId, {
        mode:
          play.mode === 'loop'
            ? { type: 'loop', randomStart: false, loop }
            : {
                type: 'recurring',
                minInterval: Math.min(play.intervalMinSec, play.intervalMaxSec),
                maxInterval: Math.max(play.intervalMinSec, play.intervalMaxSec),
                volumeJitter: jitter,
                loop,
              },
      });
    },
    setLayerLoop(layerId, loop) {
      const current = layers().find((l) => l.id === layerId);
      if (!current || current.mode.type === 'sequence') return;
      wake();
      engine.updateLayer(layerId, { mode: { ...current.mode, loop: toEngineLoop(loop) } });
    },
    togglePlaylist(playlist) {
      const id = playlistLayerId(playlist.id);
      if (layers().some((l) => l.id === id)) {
        engine.removeLayer(id);
        stopIfEmpty();
        return;
      }
      const layer = playlistLayer(playlist);
      if (!layer) return;
      wake();
      // One playlist at a time on top of the mix.
      for (const l of layers()) if (isPlaylistLayer(l.id)) engine.removeLayer(l.id);
      if (engine.getSnapshot().mix) engine.addLayer(layer);
      else engine.playMix({ id: LOOSE_MIX_ID, name: '', layers: [layer] });
    },
    skipPlaylist(layerId, delta) {
      wake();
      engine.skipLayer(layerId, delta);
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
    isMixPlaying: (mixId) =>
      snapshot.mix?.id === mixId ||
      (snapshot.mix?.layers.some((l) => l.id === playlistLayerId(mixId)) ?? false),
    isSoundPlaying: (soundId) =>
      (snapshot.mix?.layers.some((l) => l.soundId === soundId && l.mode.type !== 'sequence') ??
        false) ||
      snapshot.activeOneshots.some((o) => o.soundId === soundId),
    previewLoopTest: (sound, loop) =>
      engine.previewSequence(
        sound.id,
        {
          trackStart: loop.trackStartSec,
          trackEnd: loop.trackEndSec,
          loopStart: loop.loopStartSec,
          loopEnd: loop.loopEndSec,
          mode: loop.crossfadeSec > 0 ? 'crossfade' : 'gapless',
          crossfadeSec: loop.crossfadeSec,
        },
        { volume: sound.defaultVolume, silenceMix: true },
      ),
    waveformPeaks: (soundId, buckets) => engine.getWaveformPeaks(soundId, buckets),
    snapToZero: (soundId, time) => engine.snapToZeroCrossing(soundId, time),
    onLoadError: (cb) =>
      engine.on('error', (e) => {
        if (e.code === 'LOAD_FAILED' || e.code === 'DECODE_FAILED') cb(e.soundId);
      }),
  };
  return player;
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
    mediaSession: { artist: 'Roleplay Tunes' },
  });
  return sharedEngine;
}

const PlayerContext = createContext<Player | null>(null);

/** A sleep timer: when what plays starts fading out, and when it stops. */
export interface TimerPlan {
  /** Epoch ms. Equal to `stopAt` for a stop with no fade. */
  fadeAt: number;
  stopAt: number;
}

export interface SleepTimer {
  plan: TimerPlan | null;
  /** Stops everything in `stopInSec`, fading out over its last `fadeSec` (at most all of it). */
  start: (stopInSec: number, fadeSec: number) => void;
  cancel: () => void;
}

const SleepTimerContext = createContext<SleepTimer | null>(null);

/**
 * Runs the sleep timer. The fade is handed to the audio clock at once, so it happens even
 * if the page's timers are frozen (a locked phone); a page timer applies it again when it
 * is due, in case a pause or a master volume change cancelled it, and stops everything at
 * the end. Then the output comes back to the master volume for whatever plays next. The
 * timer goes away by itself once nothing plays anymore.
 */
function useSleepTimerRunner(engine: AudioEngine, snapshot: EngineSnapshot): SleepTimer {
  const [plan, setPlan] = useState<TimerPlan | null>(null);
  const playing = snapshot.mix !== null || snapshot.activeOneshots.length > 0;

  useEffect(() => {
    if (!plan) return;
    let stopped = false;
    const fadeFrom = () => (plan.stopAt - Math.max(Date.now(), plan.fadeAt)) / 1000;
    engine.fadeOutMaster(fadeFrom(), Math.max(0, plan.fadeAt - Date.now()) / 1000);
    const fade = window.setTimeout(
      () => engine.fadeOutMaster(fadeFrom()),
      Math.max(0, plan.fadeAt - Date.now()),
    );
    const stop = window.setTimeout(
      () => {
        stopped = true;
        engine.stop({ fadeSec: 0.05 });
        engine.stopAllOneshots(0.05);
        // Back to the set volume once the last sounds are cut, for whatever plays next.
        window.setTimeout(() => engine.restoreMaster(), 100);
        setPlan(null);
      },
      Math.max(0, plan.stopAt - Date.now()),
    );
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(stop);
      // Turned off or replaced before the end: the sound comes back at once.
      if (!stopped) engine.restoreMaster();
    };
  }, [plan, engine]);

  // Stopped by hand, or nothing left to play: the timer has nothing to stop.
  useEffect(() => {
    if (plan && !playing) setPlan(null);
  }, [plan, playing]);

  return useMemo(
    () => ({
      plan,
      start: (stopInSec, fadeSec) => {
        const stopAt = Date.now() + Math.max(1, stopInSec) * 1000;
        setPlan({ stopAt, fadeAt: stopAt - Math.min(Math.max(0, fadeSec), stopInSec) * 1000 });
      },
      cancel: () => setPlan(null),
    }),
    [plan],
  );
}

export function useSleepTimer(): SleepTimer {
  const timer = useContext(SleepTimerContext);
  if (!timer) throw new Error('useSleepTimer must be used inside PlayerProvider');
  return timer;
}

export function PlayerProvider({
  sounds,
  mixes = NO_MIXES,
  engine: injected,
  children,
}: {
  sounds: Sound[];
  /** The user's mixes and playlists, to play the playlists a mix holds. */
  mixes?: Mix[];
  /** Tests pass their own engine. */
  engine?: AudioEngine;
  children: ReactNode;
}) {
  const engine = injected ?? getSharedEngine();
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  if (!injected) lookup = (id) => byIdRef.current.get(id);
  const mixesRef = useRef(mixes);
  mixesRef.current = mixes;

  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  const player = useMemo(
    () =>
      createPlayer(
        engine,
        snapshot,
        (id) => byIdRef.current.get(id),
        (id) => mixesRef.current.find((m) => m.id === id),
      ),
    [engine, snapshot],
  );
  const timer = useSleepTimerRunner(engine, snapshot);

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

  return (
    <PlayerContext.Provider value={player}>
      <SleepTimerContext.Provider value={timer}>{children}</SleepTimerContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer must be used inside PlayerProvider');
  return player;
}

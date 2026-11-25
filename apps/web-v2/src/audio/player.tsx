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
    loopMode: sound.loopMode,
    crossfadeSec: sound.crossfadeSec,
  });

/** A mix item's loop settings: its own overrides over the sound's defaults. */
export const itemLoop = (
  sound: Sound,
  item: Pick<
    MixItem,
    'trackStartSec' | 'trackEndSec' | 'loopStartSec' | 'loopEndSec' | 'loopMode' | 'crossfadeSec'
  >,
): LoopSettings =>
  resolveLoopSettings({
    durationSec: sound.durationSec,
    trackStartSec: item.trackStartSec ?? sound.trackStartSec,
    trackEndSec: item.trackEndSec ?? sound.trackEndSec,
    loopStartSec: item.loopStartSec ?? sound.loopStartSec,
    loopEndSec: item.loopEndSec ?? sound.loopEndSec,
    loopMode: item.loopMode ?? sound.loopMode,
    crossfadeSec: item.crossfadeSec ?? sound.crossfadeSec,
  });

function toEngineLoop(loop: LoopSettings): Partial<LoopConfig> {
  return {
    trackStart: loop.trackStartSec,
    trackEnd: loop.trackEndSec,
    loopStart: loop.loopStartSec,
    loopEnd: loop.loopEndSec,
    mode: loop.loopMode,
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
    loopMode: sound.loopMode,
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
    if (seen.has(layer.soundId)) return [];
    seen.add(layer.soundId);
    const mode = layer.mode;
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
        loopMode: loop.mode ?? null,
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

export interface Player {
  snapshot: EngineSnapshot;
  /** Starts the mix, replacing what plays. Tapping the mix that plays stops it. */
  toggleMix: (mix: Mix) => void;
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
            loopMode: item.loopMode,
            crossfadeSec: item.crossfadeSec,
          }),
    };
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
        layers: playable.map((i) => toLayer(`item:${i.id}`, i.soundId, itemSettings(i))),
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
      const playing = layers().filter((l) => l.soundId === sound.id);
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
      const replaced = layers().filter((l) => l.soundId === sound.id);
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
      if (!current) return;
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
    previewLoopTest: (sound, loop) =>
      engine.previewSequence(
        sound.id,
        {
          trackStart: loop.trackStartSec,
          trackEnd: loop.trackEndSec,
          loopStart: loop.loopStartSec,
          loopEnd: loop.loopEndSec,
          mode: loop.loopMode,
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
  const player = useMemo(
    () => createPlayer(engine, snapshot, (id) => byIdRef.current.get(id)),
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

export type SoundId = string;

export interface SoundDescriptor {
  id: SoundId;
  /** Content-hashed URL, same-origin or CORS-enabled. */
  url: string;
  kind: 'loop' | 'oneshot';
  /** v1 supports 'buffer' only; 'stream' is reserved for v2 segmented streaming. */
  playback?: 'buffer' | 'stream';
  /** Seconds on the decoded buffer. Defaults: 0 / buffer duration. */
  loopStart?: number;
  loopEnd?: number;
  /** Where one play starts and stops, in seconds. Defaults: 0 / buffer duration. */
  trackStart?: number;
  trackEnd?: number;
  /** How the loop repeats at its end: 'gapless' (default) or 'crossfade'. */
  loopMode?: LoopMode;
  /** Crossfade length in seconds for 'crossfade' loops (clamped to half the loop). */
  crossfadeSec?: number;
  /** 1 => downmix to mono after decode (halves memory). */
  channels?: 1 | 2;
  /** Loudness normalization applied on top of the layer volume. */
  gainDb?: number;
  /** Default volume for one-shots (0..1). Applied when playOneshot is called without explicit volume. */
  defaultVolume?: number;
  /** One-shot polyphony per sound (step 3). */
  maxInstances?: number;
}

export type LayerMode =
  | { type: 'loop'; randomStart?: boolean; loop?: Partial<LoopConfig> }
  | {
      type: 'recurring';
      minInterval: number;
      maxInterval: number;
      volumeJitter?: [min: number, max: number];
      panJitter?: number;
      loop?: Partial<LoopConfig>;
    };

export interface LayerConfig {
  /** Stable layer id (React key). */
  id: string;
  soundId: SoundId;
  /** 0..1 slider value (mapped perceptually to gain). */
  volume: number;
  muted: boolean;
  /** -1..1, static pan. */
  pan?: number;
  mode: LayerMode;
}

export interface MixConfig {
  id: string;
  name: string;
  layers: LayerConfig[];
}

export type EngineStatus =
  'uninitialized' | 'locked' | 'idle' | 'playing' | 'paused' | 'interrupted';

export type LoadState = 'pending' | 'loading' | 'ready' | 'error';

export interface LayerState extends LayerConfig {
  load: LoadState;
}

export interface EngineSnapshot {
  status: EngineStatus;
  masterVolume: number;
  effectsVolume: number;
  mix: { id: string; name: string; layers: LayerState[] } | null;
  /**
   * Scene crossfade in progress. `endsAt` (epoch ms) is an estimate while new sounds are still
   * loading (`waiting: true`), exact once the fade has started.
   */
  transition: { fromMixId: string; toMixId: string; endsAt: number; waiting: boolean } | null;
  activeOneshotCount: number;
  /** Every one-shot playing right now, oldest first. The single source for tile progress rings. */
  activeOneshots: ActiveOneshot[];
  preview: { soundId: SoundId; region: LoopConfig; load: LoadState } | null;
  memory: { usedBytes: number; budgetBytes: number };
}

export interface ActiveOneshot {
  id: string;
  soundId: SoundId;
  /** Epoch ms (wall clock). */
  startedAt: number;
  durationSec: number;
}

export type EngineErrorCode =
  'LOAD_FAILED' | 'DECODE_FAILED' | 'MEMORY_BUDGET' | 'UNLOCK_FAILED' | 'CONTEXT_FAILED';

export interface EngineEvents {
  statusChange: { status: EngineStatus };
  layerLoaded: { layerId: string; soundId: SoundId };
  error: { code: EngineErrorCode; soundId?: SoundId; cause?: unknown };
  /** 'stolen': an older voice was cut by polyphony limits. 'not-loaded': buffer not ready in time. */
  oneshotDropped: { soundId: SoundId; reason: 'stolen' | 'not-loaded' };
  /** OS media controls (next / previous): the app decides which scene to play. */
  mediaSessionAction: { action: 'nexttrack' | 'previoustrack' };
}

export interface OneshotHandle {
  id: string;
  stop(fadeSec?: number): void;
  setVolume(v: number): void;
}

export interface Timers {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

/** Subset of navigator.mediaSession used by the engine (injectable for tests). */
export interface MediaSessionLike {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void;
}

export interface LoopRegion {
  /** Seconds. */
  loopStart: number;
  /** Seconds. */
  loopEnd: number;
}

/** How a loop repeats at its end: straight back to the loop start, or blended over itself. */
export type LoopMode = 'gapless' | 'crossfade';

/** The four markers of a sound's playback, in seconds, ordered. */
export interface LoopPoints {
  trackStart: number;
  trackEnd: number;
  loopStart: number;
  loopEnd: number;
}

/** Loop points plus how the loop repeats. */
export interface LoopConfig extends LoopPoints {
  mode: LoopMode;
  crossfadeSec: number;
}

export interface LoopPreviewHandle {
  /** Applied live on the playing source (takes effect at the next loop pass). */
  update(cfg: Partial<LoopConfig>): void;
  /** Restarts the test sequence from the track start. */
  playFromStart(): void;
  /** Jumps the playhead to `sec` (wrapped into the loop) without stopping playback. */
  seekTo(sec: number): void;
  /** Freezes the playhead; the main mix stays silent until resume/stop. */
  pause(): void;
  /** Continues from the paused playhead. */
  resume(): void;
  /** Jump to loopEnd - sec (default 2) to hear the seam right away. */
  auditionSeam(sec?: number): void;
  /** Seconds in the buffer, for the editor playhead (poll in requestAnimationFrame). */
  getPosition(): number;
  /** True while the test sequence is playing (not paused). */
  isPlaying(): boolean;
  stop(): void;
}

export interface AudioEngineOptions {
  resolveSound: (id: SoundId) => SoundDescriptor | undefined;
  fetchSound?: (descriptor: SoundDescriptor) => Promise<ArrayBuffer>;
  /** v1 default 'destination'; 'media-element' is a later opt-in background mode. */
  output?: 'destination';
  /** Default 'interactive' (instant one-shots). */
  latencyHint?: AudioContextLatencyCategory;
  /** Decoded PCM budget. Default 150 MB on mobile/iOS, 400 MB otherwise. */
  memoryBudgetBytes?: number;
  /** Master limiter (DynamicsCompressor). Default true. */
  limiter?: boolean;
  /** Install one-shot gesture listeners on this target to unlock audio. Default `document` if present. */
  autoUnlock?: EventTarget | false;
  /** Total one-shot voices. Default 8. Per-sound limit: `SoundDescriptor.maxInstances` (default 3). */
  maxOneshotVoices?: number;
  /** A one-shot whose buffer is not ready within this delay is dropped. Default 300 ms. */
  oneshotMaxLatencyMs?: number;
  /** Media Session (OS media controls). Default enabled when `navigator.mediaSession` exists. */
  mediaSession?: { artist?: string; artwork?: MediaImage[]; api?: MediaSessionLike } | false;
  // test seams
  createContext?: () => AudioContext;
  rng?: () => number;
  timers?: Timers;
  /** Wall clock (epoch ms). Default Date.now. */
  now?: () => number;
}

export interface PlayMixOptions {
  /** Equal-power crossfade from the current mix. Default 3 s (0 = cut). */
  crossfadeSec?: number;
  /** Loop layers with the same soundId keep playing across the switch. Default true. */
  reuseMatchingLayers?: boolean;
  /** Max wait for the new mix's sounds before the crossfade starts anyway. Default 2 s. */
  maxWaitSec?: number;
}

export interface AudioEngine {
  /** React store contract (useSyncExternalStore). */
  subscribe(listener: () => void): () => void;
  /** Same reference until something changes. */
  getSnapshot(): EngineSnapshot;
  on<K extends keyof EngineEvents>(type: K, cb: (e: EngineEvents[K]) => void): () => void;

  /** Call from a user gesture (pointerup / touchend / click / keydown). */
  unlock(): Promise<void>;
  preload(ids: SoundId[]): Promise<void>;

  /** Starts a mix, crossfading from the current one. */
  playMix(mix: MixConfig, opts?: PlayMixOptions): void;
  updateLayer(layerId: string, patch: Partial<Omit<LayerConfig, 'id'>>): void;
  addLayer(layer: LayerConfig): void;
  removeLayer(layerId: string, opts?: { fadeSec?: number }): void;
  /** Re-reads the descriptor (e.g. new loop points) and applies it to playing layers. */
  refreshSound(id: SoundId): void;

  setMasterVolume(v: number): void;
  /**
   * Fades the whole output to silence over `sec`, starting `delaySec` from now, as a sleep
   * timer does. It is scheduled on the audio clock, so it happens even while the page's
   * timers are frozen (a locked phone). The master volume setting is untouched: what plays
   * keeps playing, silently. Moving the master volume, pausing and resuming, or
   * `restoreMaster()` cancel the fade and bring the output back.
   */
  fadeOutMaster(sec: number, delaySec?: number): void;
  /** Brings the output back to the master volume setting at once. */
  restoreMaster(): void;
  setEffectsVolume(v: number): void;
  /** Plays a one-shot above the mix. Returns null if the sound is unknown. */
  playOneshot(
    id: SoundId,
    opts?: { volume?: number; pan?: number; trackStart?: number; trackEnd?: number },
  ): OneshotHandle | null;
  stopAllOneshots(fadeSec?: number): void;

  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(opts?: { fadeSec?: number }): void;

  previewLoop(
    id: SoundId,
    region: LoopRegion,
    opts?: { auditionSeamSec?: number; volume?: number },
  ): LoopPreviewHandle;
  /**
   * Plays the full test sequence of the loop editor: from trackStart into the loop, with the
   * loop's own mode (gapless or crossfading). With `silenceMix` the main mix is paused (its
   * output goes to zero) for as long as the preview runs.
   */
  previewSequence(
    id: SoundId,
    cfg: Partial<LoopConfig>,
    opts?: { volume?: number; silenceMix?: boolean },
  ): LoopPreviewHandle;
  /** Max |sample| per bucket across channels, 0..1. */
  getWaveformPeaks(id: SoundId, buckets: number): Promise<Float32Array>;
  /** Nearest zero crossing to `time` within ±windowSec (returns `time` if none). */
  snapToZeroCrossing(id: SoundId, time: number, windowSec?: number): Promise<number>;

  /** Closes the context, drops buffers, removes listeners. */
  dispose(): Promise<void>;
}

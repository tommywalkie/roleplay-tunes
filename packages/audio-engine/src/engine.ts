import { defaultMediaSession, MediaSessionController } from './context/media-session';
import { installGestureUnlock, primeContext } from './context/unlock';
import { Emitter } from './emitter';
import { Layer, type LayerFadeIn } from './graph/layer';
import { LoopPreview } from './graph/loop-preview';
import { DEFAULT_MAX_ONESHOT_VOICES, OneshotBus } from './graph/oneshot-bus';
import { BufferCache } from './loading/buffer-cache';
import { computePeaks, findZeroCrossing } from './loading/buffer-utils';
import { defaultFetchSound, LoadError, Loader } from './loading/loader';
import { clamp, dbToGain, fadeTo, rampTo, sliderToGain } from './params';
import { Store } from './store';
import type {
  AudioEngine,
  AudioEngineOptions,
  EngineEvents,
  EngineSnapshot,
  EngineStatus,
  LayerConfig,
  LayerState,
  LoadState,
  LoopPreviewHandle,
  LoopRegion,
  MixConfig,
  PlayMixOptions,
  OneshotHandle,
  SoundDescriptor,
  SoundId,
  Timers,
} from './types';

const MB = 1024 * 1024;
const LAYER_FADE_SEC = 0.3;
const CUT_FADE_SEC = 0.05;
const DEFAULT_CROSSFADE_SEC = 3;
const DEFAULT_MAX_WAIT_SEC = 2;
/** A crossfade interrupted by another playMix is finished quickly. */
const FAST_FADE_SEC = 0.3;
const PAUSE_FADE_SEC = 0.15;
const PREVIEW_DUCK_DB = -12;
const DEFAULT_ONESHOT_MAX_LATENCY_MS = 300;

export function defaultMemoryBudget(): number {
  if (typeof navigator === 'undefined') return 400 * MB;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ios =
    /iPad|iPhone|iPod/.test(nav.userAgent) ||
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  return (ios || lowMemory ? 150 : 400) * MB;
}

interface Graph {
  ctx: AudioContext;
  /** Layers connect here; ducked during loop preview. */
  mixInput: GainNode;
  master: GainNode;
  oneshot: OneshotBus;
}

interface Transition {
  fromMixId: string;
  toMixId: string;
  crossfadeSec: number;
  outgoing: Layer[];
  incoming: Layer[];
  /** Incoming layers still loading; the fade starts when empty or after maxWaitSec. */
  pending: Set<Layer>;
  started: boolean;
  waitTimer: unknown;
  endTimer: unknown;
}

function toConfig(state: LayerState): LayerConfig {
  const config: LayerConfig & { load?: LoadState } = { ...state };
  delete config.load;
  return config;
}

export function createAudioEngine(options: AudioEngineOptions): AudioEngine {
  return new Engine(options);
}

/**
 * The AudioContext could not be created at all — e.g. Playwright's Windows WebKit
 * ships without Web Audio (microsoft/playwright#14105). Emitted once as an
 * 'error' event with code 'CONTEXT_FAILED', then rethrown to every caller so the
 * engine stays a clean, observable no-op instead of leaking uncaught errors.
 */
export class ContextFailedError extends Error {
  constructor(cause: unknown) {
    super('AudioContext construction failed', { cause });
    this.name = 'ContextFailedError';
  }
}

class Engine implements AudioEngine {
  private graph: Graph | null = null;
  /** Layers of the current mix, by layer id. */
  private layers = new Map<string, Layer>();
  private loadStates = new WeakMap<Layer, LoadState>();
  private transition: Transition | null = null;
  private preview: LoopPreview | null = null;
  private mediaSession: MediaSessionController | null = null;
  private oneshotCounter = 0;
  /** Bumped by stopAllOneshots: one-shots still loading from an earlier epoch are dropped. */
  private oneshotEpoch = 0;
  private paused = false;
  private disposed = false;
  /** Set once when the AudioContext cannot be created; every later use rethrows it. */
  private contextError: ContextFailedError | null = null;
  private removeGestureUnlock: (() => void) | null = null;
  private removeVisibility: (() => void) | null = null;
  private readonly store: Store<EngineSnapshot>;
  private readonly emitter = new Emitter<EngineEvents>();
  private readonly cache: BufferCache;
  private readonly loader: Loader;
  private readonly rng: () => number;
  private readonly now: () => number;
  private readonly timers: Timers;

  constructor(private options: AudioEngineOptions) {
    this.rng = options.rng ?? Math.random;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
    const budgetBytes = options.memoryBudgetBytes ?? defaultMemoryBudget();
    this.cache = new BufferCache(budgetBytes, () =>
      this.store?.update((s) => ({
        ...s,
        memory: { usedBytes: this.cache.usedBytes, budgetBytes },
      })),
    );
    this.loader = new Loader(
      () => this.ensureGraph().ctx,
      options.resolveSound,
      options.fetchSound ?? defaultFetchSound,
      this.cache,
    );
    this.store = new Store<EngineSnapshot>({
      status: 'uninitialized',
      masterVolume: 1,
      effectsVolume: 1,
      mix: null,
      transition: null,
      activeOneshotCount: 0,
      activeOneshots: [],
      preview: null,
      memory: { usedBytes: 0, budgetBytes },
    });
    this.setupMediaSession();
  }

  // undefined

  subscribe = (listener: () => void) => this.store.subscribe(listener);
  getSnapshot = () => this.store.get();

  on<K extends keyof EngineEvents>(type: K, cb: (e: EngineEvents[K]) => void) {
    return this.emitter.on(type, cb);
  }

  // undefined

  async unlock(): Promise<void> {
    await this.tryUnlock();
  }

  private async tryUnlock(): Promise<boolean> {
    if (this.disposed) return false;
    let ctx: AudioContext;
    try {
      ({ ctx } = this.ensureGraph());
    } catch (cause) {
      // ensureGraph already emitted CONTEXT_FAILED; a gesture handler must not leak.
      if (cause instanceof ContextFailedError) return false;
      throw cause;
    }
    if (this.paused) return false;
    if (ctx.state === 'running') return true;
    try {
      primeContext(ctx);
      await ctx.resume();
    } catch (cause) {
      this.emitter.emit('error', { code: 'UNLOCK_FAILED', cause });
    }
    this.syncStatus();
    return (ctx.state as AudioContextState) === 'running'; // re-read after await
  }

  private ensureGraph(): Graph {
    if (this.graph) return this.graph;
    if (this.disposed) throw new Error('AudioEngine is disposed');
    if (this.contextError) throw this.contextError;
    let ctx: AudioContext;
    try {
      ctx =
        this.options.createContext?.() ??
        new AudioContext({ latencyHint: this.options.latencyHint ?? 'interactive' });
    } catch (cause) {
      this.contextError = new ContextFailedError(cause);
      this.emitter.emit('error', { code: 'CONTEXT_FAILED', cause });
      throw this.contextError;
    }
    const mixInput = ctx.createGain();
    const master = ctx.createGain();
    master.gain.value = sliderToGain(this.store.get().masterVolume);
    mixInput.connect(master);
    if (this.options.limiter !== false) {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      master.connect(limiter).connect(ctx.destination);
    } else {
      master.connect(ctx.destination);
    }
    const oneshot = new OneshotBus(ctx, master, this.options.maxOneshotVoices ?? DEFAULT_MAX_ONESHOT_VOICES, {
      now: this.now,
      onVoicesChange: (activeOneshots) =>
        this.store.update((s) => ({ ...s, activeOneshots, activeOneshotCount: activeOneshots.length })),
      onStolen: (soundId) => this.emitter.emit('oneshotDropped', { soundId, reason: 'stolen' }),
      onVoiceEnded: (soundId) => this.cache.release(soundId),
    });
    oneshot.gain.gain.value = sliderToGain(this.store.get().effectsVolume);
    ctx.onstatechange = () => this.syncStatus();
    this.graph = { ctx, mixInput, master, oneshot };
    this.installPlatformListeners();
    this.syncStatus();
    return this.graph;
  }

  private installPlatformListeners() {
    if (typeof document !== 'undefined') {
      const onVisible = () => {
        const ctx = this.graph?.ctx;
        if (document.visibilityState !== 'visible' || !ctx || this.paused) return;
        if (ctx.state !== 'running')
          void ctx
            .resume()
            .catch(() => {})
            .then(() => this.syncStatus());
      };
      document.addEventListener('visibilitychange', onVisible);
      this.removeVisibility = () => document.removeEventListener('visibilitychange', onVisible);
    }
    this.ensureGestureUnlock();
  }

  private ensureGestureUnlock() {
    if (this.removeGestureUnlock || this.disposed) return;
    const target =
      this.options.autoUnlock ?? (typeof document !== 'undefined' ? document : undefined);
    if (!target) return;
    const remove = installGestureUnlock(target, async () => {
      const ok = await this.tryUnlock();
      if (ok) this.removeGestureUnlock = null;
      return ok;
    });
    this.removeGestureUnlock = remove;
  }

  private setupMediaSession() {
    const opts = this.options.mediaSession;
    if (opts === false) return;
    const api = opts?.api ?? defaultMediaSession();
    if (!api) return;
    const controller = new MediaSessionController(
      api,
      { artist: opts?.artist ?? 'Roleplay Tunes', artwork: opts?.artwork },
      {
        play: () => void (this.paused ? this.resume() : this.unlock()),
        pause: () => void this.pause(),
        stop: () => this.stop(),
        nexttrack: () => this.emitter.emit('mediaSessionAction', { action: 'nexttrack' }),
        previoustrack: () => this.emitter.emit('mediaSessionAction', { action: 'previoustrack' }),
      },
    );
    this.mediaSession = controller;
    this.store.subscribe(() => {
      const s = this.store.get();
      controller.sync({
        title: s.mix?.name ?? null,
        playbackState: s.status === 'playing' ? 'playing' : s.mix ? 'paused' : 'none',
      });
    });
  }

  private computeStatus(): EngineStatus {
    const ctx = this.graph?.ctx;
    if (!ctx || ctx.state === 'closed') return 'uninitialized';
    if ((ctx.state as string) === 'interrupted') return 'interrupted';
    if (this.paused) return 'paused';
    if (ctx.state !== 'running') return 'locked';
    return this.store.get().mix ? 'playing' : 'idle';
  }

  private syncStatus() {
    const status = this.computeStatus();
    if (status === this.store.get().status) return;
    this.store.update((s) => ({ ...s, status }));
    this.emitter.emit('statusChange', { status });
    if (status === 'locked') this.ensureGestureUnlock();
  }

  // undefined

  async preload(ids: SoundId[]): Promise<void> {
    await Promise.all(
      ids.map((id) => this.loader.load(id).catch((e: unknown) => this.emitLoadError(e, id))),
    );
  }

  private emitLoadError(e: unknown, soundId: SoundId) {
    const code = e instanceof LoadError ? e.code : 'LOAD_FAILED';
    this.emitter.emit('error', { code, soundId, cause: e instanceof LoadError ? e.cause : e });
  }

  // undefined

  playMix(mix: MixConfig, opts: PlayMixOptions = {}) {
    const crossfadeSec = Math.max(0, opts.crossfadeSec ?? DEFAULT_CROSSFADE_SEC);
    const maxWaitSec = opts.maxWaitSec ?? DEFAULT_MAX_WAIT_SEC;
    this.ensureGraph();
    const prevMix = this.store.get().mix;
    this.finishTransition();
    const old = this.layers;
    this.layers = new Map();
    this.store.update((s) => ({
      ...s,
      mix: {
        id: mix.id,
        name: mix.name,
        layers: mix.layers.map((l) => ({ ...l, load: 'pending' as LoadState })),
      },
    }));

    if (!prevMix || old.size === 0 || crossfadeSec === 0) {
      for (const layer of old.values()) this.destroyLayer(layer, CUT_FADE_SEC);
      for (const config of mix.layers) this.createLayer(config);
      this.syncStatus();
      return;
    }

    const reuse = opts.reuseMatchingLayers ?? true;
    const incoming: Layer[] = [];
    const pending = new Set<Layer>();
    for (const config of mix.layers) {
      const carried = reuse
        ? [...old.values()].find(
            (l) =>
              config.mode.type === 'loop' && l.mode.type === 'loop' && l.soundId === config.soundId,
          )
        : undefined;
      if (carried) {
        old.delete(carried.id);
        carried.reassign(config, crossfadeSec);
        this.layers.set(config.id, carried);
        this.setLayerLoad(config.id, this.loadStates.get(carried) ?? 'loading');
        continue;
      }
      const layer = this.createLayer(config, 'hold');
      incoming.push(layer);
      if (this.loadStates.get(layer) === 'loading') pending.add(layer);
    }

    const t: Transition = {
      fromMixId: prevMix.id,
      toMixId: mix.id,
      crossfadeSec,
      outgoing: [...old.values()],
      incoming,
      pending,
      started: false,
      waitTimer: null,
      endTimer: null,
    };
    this.transition = t;
    this.store.update((s) => ({
      ...s,
      transition: {
        fromMixId: t.fromMixId,
        toMixId: t.toMixId,
        endsAt: this.now() + (maxWaitSec + crossfadeSec) * 1000,
        waiting: true,
      },
    }));
    if (pending.size === 0) this.startCrossfade(t);
    else t.waitTimer = this.timers.setTimeout(() => this.startCrossfade(t), maxWaitSec * 1000);
    this.syncStatus();
  }

  private startCrossfade(t: Transition) {
    if (this.transition !== t || t.started) return;
    t.started = true;
    if (t.waitTimer !== null) this.timers.clearTimeout(t.waitTimer);
    for (const layer of t.outgoing) this.destroyLayer(layer, t.crossfadeSec, true);
    for (const layer of t.incoming) layer.beginFadeIn(t.crossfadeSec);
    const endsAt = this.now() + t.crossfadeSec * 1000;
    this.store.update((s) =>
      s.transition ? { ...s, transition: { ...s.transition, endsAt, waiting: false } } : s,
    );
    t.endTimer = this.timers.setTimeout(() => {
      if (this.transition !== t) return;
      this.transition = null;
      this.store.update((s) => ({ ...s, transition: null }));
    }, t.crossfadeSec * 1000);
  }

  /** Ends the current transition right away (interrupted by playMix / stop). */
  private finishTransition() {
    const t = this.transition;
    if (!t) return;
    this.transition = null;
    if (t.waitTimer !== null) this.timers.clearTimeout(t.waitTimer);
    if (t.endTimer !== null) this.timers.clearTimeout(t.endTimer);
    if (!t.started) {
      for (const layer of t.outgoing) this.destroyLayer(layer, FAST_FADE_SEC, true);
      for (const layer of t.incoming) layer.beginFadeIn(FAST_FADE_SEC);
    }
    this.store.update((s) => ({ ...s, transition: null }));
  }

  /** An incoming layer finished loading (or failed): start the crossfade once all are settled. */
  private settlePending(layer: Layer) {
    const t = this.transition;
    if (!t || !t.pending.delete(layer)) return;
    if (t.pending.size === 0) this.startCrossfade(t);
  }

  addLayer(layer: LayerConfig) {
    const mix = this.store.get().mix;
    if (!mix) {
      this.playMix({ id: 'custom', name: 'Custom', layers: [layer] });
      return;
    }
    if (mix.layers.some((l) => l.id === layer.id)) {
      this.updateLayer(layer.id, layer);
      return;
    }
    this.setLayers((layers) => [...layers, { ...layer, load: 'pending' }]);
    this.createLayer(layer);
  }

  updateLayer(layerId: string, patch: Partial<Omit<LayerConfig, 'id'>>) {
    const current = this.store.get().mix?.layers.find((l) => l.id === layerId);
    const layer = this.layers.get(layerId);
    if (!current || !layer) return;
    const next: LayerConfig = { ...toConfig(current), ...patch, id: layerId };
    const replace = next.soundId !== layer.soundId || next.mode.type !== layer.mode.type;
    if (replace) {
      this.destroyLayer(layer, LAYER_FADE_SEC);
      this.setLayers((layers) =>
        layers.map((l) => (l.id === layerId ? { ...next, load: 'pending' } : l)),
      );
      this.createLayer(next);
    } else {
      layer.update(patch);
      this.setLayers((layers) => layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)));
    }
  }

  removeLayer(layerId: string, opts: { fadeSec?: number } = {}) {
    const layer = this.layers.get(layerId);
    if (!layer) return;
    this.destroyLayer(layer, opts.fadeSec ?? LAYER_FADE_SEC);
    this.setLayers((layers) => layers.filter((l) => l.id !== layerId));
  }

  refreshSound(id: SoundId) {
    const descriptor = this.options.resolveSound(id);
    for (const layer of this.layers.values()) {
      if (layer.soundId === id) layer.setDescriptor(descriptor);
    }
  }

  stop(opts: { fadeSec?: number } = {}) {
    this.finishTransition();
    for (const layer of this.layers.values()) {
      this.destroyLayer(layer, opts.fadeSec ?? LAYER_FADE_SEC);
    }
    this.store.update((s) => ({ ...s, mix: null }));
    this.syncStatus();
  }

  private createLayer(config: LayerConfig, fadeIn?: LayerFadeIn): Layer {
    const { ctx, mixInput } = this.ensureGraph();
    const layer = new Layer(
      { ctx, destination: mixInput, rng: this.rng, timers: this.timers },
      config,
      this.options.resolveSound(config.soundId),
      fadeIn,
    );
    this.layers.set(config.id, layer);
    this.cache.retain(config.soundId);
    this.loadStates.set(layer, 'loading');
    this.setLayerLoad(config.id, 'loading');
    const isCurrent = () => this.layers.get(layer.id) === layer;
    this.loader.load(config.soundId).then(
      (buffer) => {
        this.loadStates.set(layer, 'ready');
        if (layer.isStopped) return;
        layer.setBuffer(buffer);
        if (isCurrent()) {
          this.setLayerLoad(layer.id, 'ready');
          this.emitter.emit('layerLoaded', { layerId: layer.id, soundId: layer.soundId });
        }
        this.settlePending(layer);
      },
      (e: unknown) => {
        this.loadStates.set(layer, 'error');
        if (!layer.isStopped && isCurrent()) {
          this.setLayerLoad(layer.id, 'error');
          this.emitLoadError(e, layer.soundId);
        }
        this.settlePending(layer);
      },
    );
    return layer;
  }

  private destroyLayer(layer: Layer, fadeSec: number, equalPower = false) {
    if (layer.isStopped) return;
    layer.stop(fadeSec, equalPower);
    if (this.layers.get(layer.id) === layer) this.layers.delete(layer.id);
    this.cache.release(layer.soundId);
    this.settlePending(layer);
  }

  private setLayers(fn: (layers: LayerState[]) => LayerState[]) {
    this.store.update((s) => (s.mix ? { ...s, mix: { ...s.mix, layers: fn(s.mix.layers) } } : s));
  }

  private setLayerLoad(layerId: string, load: LoadState) {
    this.setLayers((layers) => layers.map((l) => (l.id === layerId ? { ...l, load } : l)));
  }

  // undefined

  playOneshot(id: SoundId, opts: { volume?: number; pan?: number } = {}): OneshotHandle | null {
    const descriptor = this.options.resolveSound(id);
    if (!descriptor) {
      this.emitter.emit('error', { code: 'LOAD_FAILED', soundId: id });
      return null;
    }
    this.ensureGraph();
    const handleId = `oneshot-${++this.oneshotCounter}`;
    const volume = opts.volume !== undefined ? opts.volume : descriptor.defaultVolume;
    const optsWithVolume = { ...opts, volume };
    const buffer = this.cache.get(id);
    if (buffer) {
      const voice = this.startOneshot(descriptor, buffer, optsWithVolume);
      const voiceId = voice.id;
      return {
        id: handleId,
        stop: (fadeSec) => voice.stop(fadeSec),
        setVolume: (v) => this.graph?.oneshot.setVoiceVolume(voiceId, v),
      };
    }
    const requestedAt = this.now();
    const maxLatency = this.options.oneshotMaxLatencyMs ?? DEFAULT_ONESHOT_MAX_LATENCY_MS;
    let voice: OneshotHandle | null = null;
    let voiceId: string | null = null;
    let cancelled = false;
    const epoch = this.oneshotEpoch;
    this.loader.load(id).then(
      (loaded) => {
        // Stopped while loading, one by one or by stopAllOneshots: it must not start late.
        if (cancelled || this.disposed || epoch !== this.oneshotEpoch) return;
        if (this.now() - requestedAt > maxLatency) {
          this.emitter.emit('oneshotDropped', { soundId: id, reason: 'not-loaded' });
          return;
        }
        voice = this.startOneshot(descriptor, loaded, optsWithVolume);
        voiceId = voice.id;
      },
      (e: unknown) => {
        this.emitLoadError(e, id);
        this.emitter.emit('oneshotDropped', { soundId: id, reason: 'not-loaded' });
      },
    );
    return {
      id: handleId,
      stop: (fadeSec) => {
        cancelled = true;
        voice?.stop(fadeSec);
      },
      setVolume: (v) => {
        if (voiceId) this.graph?.oneshot.setVoiceVolume(voiceId, v);
      },
    };
  }

  private startOneshot(
    descriptor: SoundDescriptor,
    buffer: AudioBuffer,
    opts: { volume?: number; pan?: number },
  ) {
    this.cache.retain(descriptor.id);
    return this.ensureGraph().oneshot.play(descriptor, buffer, opts);
  }

  stopAllOneshots(fadeSec?: number) {
    this.oneshotEpoch++;
    this.graph?.oneshot.stopAll(fadeSec);
  }

  setEffectsVolume(v: number) {
    const effectsVolume = clamp(v, 0, 1);
    this.store.update((s) => ({ ...s, effectsVolume }));
    this.graph?.oneshot.setVolume(effectsVolume);
  }

  // undefined

  setMasterVolume(v: number) {
    const masterVolume = clamp(v, 0, 1);
    this.store.update((s) => ({ ...s, masterVolume }));
    if (this.graph && !this.paused) {
      rampTo(this.graph.master.gain, sliderToGain(masterVolume), this.graph.ctx.currentTime);
    }
  }

  fadeOutMaster(sec: number, delaySec = 0) {
    if (!this.graph || this.paused) return;
    const gain = this.graph.master.gain;
    const now = this.graph.ctx.currentTime;
    const start = now + Math.max(0, delaySec);
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setValueAtTime(gain.value, start);
    gain.linearRampToValueAtTime(0, start + Math.max(0.05, sec));
  }

  restoreMaster() {
    if (!this.graph || this.paused) return;
    rampTo(
      this.graph.master.gain,
      sliderToGain(this.store.get().masterVolume),
      this.graph.ctx.currentTime,
    );
  }

  async pause(): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    this.syncStatus();
    const graph = this.graph;
    if (!graph) return;
    fadeTo(graph.master.gain, 0, graph.ctx.currentTime, PAUSE_FADE_SEC);
    await new Promise<void>((r) => this.timers.setTimeout(r, PAUSE_FADE_SEC * 1000));
    if (this.paused && graph.ctx.state === 'running') await graph.ctx.suspend();
    this.syncStatus();
  }

  async resume(): Promise<void> {
    if (!this.paused) return;
    this.paused = false;
    const graph = this.graph;
    if (graph) {
      try {
        await graph.ctx.resume();
      } catch {
        // Stays 'locked' until the next gesture.
      }
      const target = sliderToGain(this.store.get().masterVolume);
      fadeTo(graph.master.gain, target, graph.ctx.currentTime, PAUSE_FADE_SEC);
    }
    this.syncStatus();
  }

  // undefined

  previewLoop(
    id: SoundId,
    region: LoopRegion,
    opts: { auditionSeamSec?: number; volume?: number } = {},
  ): LoopPreviewHandle {
    this.preview?.stop();
    const { ctx, master, mixInput } = this.ensureGraph();
    const preview = new LoopPreview(ctx, master, region, sliderToGain(opts.volume ?? 1));
    this.preview = preview;
    rampTo(mixInput.gain, dbToGain(PREVIEW_DUCK_DB), ctx.currentTime);
    this.cache.retain(id);
    if (opts.auditionSeamSec !== undefined) preview.auditionSeam(opts.auditionSeamSec);
    const setPreview = (patch: Partial<NonNullable<EngineSnapshot['preview']>>) =>
      this.store.update((s) => (s.preview ? { ...s, preview: { ...s.preview, ...patch } } : s));
    this.store.update((s) => ({ ...s, preview: { soundId: id, region, load: 'loading' } }));

    const active = () => this.preview === preview;
    this.loader.load(id).then(
      (buffer) => {
        if (!active()) return;
        preview.setBuffer(buffer);
        setPreview({ load: 'ready', region: preview.currentRegion });
      },
      (e: unknown) => {
        if (!active()) return;
        setPreview({ load: 'error' });
        this.emitLoadError(e, id);
      },
    );

    return {
      update: (r) => {
        if (active()) setPreview({ region: preview.update(r) });
      },
      auditionSeam: (sec) => {
        if (active()) preview.auditionSeam(sec);
      },
      getPosition: () => preview.getPosition(),
      stop: () => {
        if (!active()) return;
        preview.stop();
        this.preview = null;
        this.cache.release(id);
        rampTo(mixInput.gain, 1, ctx.currentTime);
        this.store.update((s) => ({ ...s, preview: null }));
      },
    };
  }

  async getWaveformPeaks(id: SoundId, buckets: number): Promise<Float32Array> {
    return computePeaks(await this.loader.load(id), buckets);
  }

  async snapToZeroCrossing(id: SoundId, time: number, windowSec?: number): Promise<number> {
    return findZeroCrossing(await this.loader.load(id), time, windowSec);
  }

  // undefined

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.removeGestureUnlock?.();
    this.removeVisibility?.();
    this.finishTransition();
    this.preview?.stop();
    this.preview = null;
    for (const layer of this.layers.values()) layer.stop(0);
    this.layers.clear();
    this.graph?.oneshot.stopAll(0);
    this.mediaSession?.dispose();
    this.cache.clear();
    const ctx = this.graph?.ctx;
    this.graph = null;
    if (ctx) {
      ctx.onstatechange = null;
      await ctx.close();
    }
    this.store.update((s) => ({
      ...s,
      status: 'uninitialized',
      mix: null,
      preview: null,
      transition: null,
      activeOneshotCount: 0,
      activeOneshots: [],
    }));
    this.emitter.clear();
    this.store.clear();
  }
}

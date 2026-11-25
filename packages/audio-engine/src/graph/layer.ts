import { resolveLoopConfig } from '../loading/buffer-utils';
import { dbToGain, equalPowerFade, fadeTo, rampTo, sliderToGain } from '../params';
import { CrossfadeLoop } from './crossfade-loop';
import type { LayerConfig, LoopConfig, LoopRegion, SoundDescriptor, Timers } from '../types';

export const LAYER_FADE_IN_SEC = 0.3;
/** Max overlapping voices of one recurring-interval layer (a long thunder clip won't stack). */
export const RECURRING_MAX_OVERLAP = 2;
const MIN_RECURRING_INTERVAL_SEC = 0.1;
const VOICE_STEAL_FADE_SEC = 0.03;
/** A timer firing this close to the event time counts as "on time". */
const TIMER_SLACK_SEC = 0.05;

/**
 * Playback position of a looping source started at `offset`, `elapsed` seconds ago
 * (Web Audio semantics: plays forward until loopEnd, then wraps to loopStart).
 */
export function loopPosition(offset: number, elapsed: number, region: LoopRegion): number {
  const p = offset + Math.max(0, elapsed);
  if (p < region.loopEnd) return p;
  const len = region.loopEnd - region.loopStart;
  return region.loopStart + ((p - region.loopStart) % len);
}

export interface LayerDeps {
  ctx: BaseAudioContext;
  destination: AudioNode;
  rng: () => number;
  timers: Timers;
}

/** How the layer fades in once its buffer is ready. 'hold' waits for beginFadeIn() (crossfade). */
export type LayerFadeIn = { sec: number; equalPower: boolean } | 'hold';

interface Voice {
  source: AudioBufferSourceNode;
  nodes: AudioNode[];
}

/**
 * One mix layer: source(s) → [event gain → event panner] → voiceGain → [StereoPanner] → layerGain
 * → muteGain → mix input.
 * - voiceGain: fade in / fade out / scene crossfade.
 * - Loop mode: one gapless looping AudioBufferSourceNode.
 * - Recurring mode: one-shots scheduled on the audio clock, always one event queued ahead.
 */
export class Layer {
  private voiceGain: GainNode;
  private layerGain: GainNode;
  private muteGain: GainNode;
  private panner: StereoPannerNode | null = null;
  private loopSource: AudioBufferSourceNode | null = null;
  private looper: CrossfadeLoop | null = null;
  private voices: Voice[] = [];
  private buffer: AudioBuffer | null = null;
  private nextTimer: unknown = null;
  private nextWhen: number | null = null;
  private started = false;
  private stopped = false;
  private ctx: BaseAudioContext;

  constructor(
    private deps: LayerDeps,
    private config: LayerConfig,
    private descriptor: SoundDescriptor | undefined,
    private fadeIn: LayerFadeIn = { sec: LAYER_FADE_IN_SEC, equalPower: false },
  ) {
    const ctx = (this.ctx = deps.ctx);
    this.voiceGain = ctx.createGain();
    this.layerGain = ctx.createGain();
    this.muteGain = ctx.createGain();
    this.voiceGain.gain.value = 0;
    this.layerGain.gain.value = this.targetGain();
    this.muteGain.gain.value = config.muted ? 0 : 1;
    let tail: AudioNode = this.voiceGain;
    if (typeof ctx.createStereoPanner === 'function') {
      this.panner = ctx.createStereoPanner();
      this.panner.pan.value = config.pan ?? 0;
      tail = tail.connect(this.panner);
    }
    tail.connect(this.layerGain).connect(this.muteGain).connect(deps.destination);
  }

  get id() {
    return this.config.id;
  }

  get soundId() {
    return this.config.soundId;
  }

  get mode() {
    return this.config.mode;
  }

  get isStopped() {
    return this.stopped;
  }

  setBuffer(buffer: AudioBuffer) {
    if (this.stopped || this.started) return;
    this.buffer = buffer;
    this.started = true;
    if (this.config.mode.type === 'loop') this.startLoop();
    else {
      // The first play starts right away, like any other mode; pauses only come between plays.
      const now = this.ctx.currentTime;
      this.queueEvent(now);
      this.armTimer(now);
    }
    this.applyFadeIn();
  }

  /** Releases a 'hold' fade-in (crossfade start). Applies when the buffer arrives if not ready yet. */
  beginFadeIn(sec: number) {
    this.fadeIn = { sec, equalPower: true };
    if (this.started) this.applyFadeIn();
  }

  /** Volume / mute / pan / interval changes. soundId or mode-type changes replace the layer. */
  update(patch: Partial<Omit<LayerConfig, 'id'>>) {
    this.config = { ...this.config, ...patch };
    const now = this.ctx.currentTime;
    if (patch.volume !== undefined) rampTo(this.layerGain.gain, this.targetGain(), now);
    if (patch.muted !== undefined) rampTo(this.muteGain.gain, patch.muted ? 0 : 1, now);
    if (patch.pan !== undefined && this.panner) rampTo(this.panner.pan, patch.pan, now);
    if (patch.mode !== undefined) this.syncLoop();
  }

  /** Carry-over into a new mix: keeps playing, glides to the new layer's settings. */
  reassign(config: LayerConfig, glideSec: number) {
    const now = this.ctx.currentTime;
    this.config = { ...config };
    fadeTo(this.layerGain.gain, this.targetGain(), now, glideSec);
    rampTo(this.muteGain.gain, config.muted ? 0 : 1, now);
    if (this.panner) rampTo(this.panner.pan, config.pan ?? 0, now);
  }

  setDescriptor(descriptor: SoundDescriptor | undefined) {
    this.descriptor = descriptor;
    rampTo(this.layerGain.gain, this.targetGain(), this.ctx.currentTime);
    this.syncLoop();
  }

  stop(fadeSec = LAYER_FADE_IN_SEC, equalPower = false) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.nextTimer !== null) this.deps.timers.clearTimeout(this.nextTimer);
    this.nextTimer = null;
    const now = this.ctx.currentTime;
    if (equalPower) equalPowerFade(this.voiceGain.gain, 0, now, fadeSec);
    else fadeTo(this.voiceGain.gain, 0, now, fadeSec);

    const chain = [this.voiceGain, this.panner, this.layerGain, this.muteGain];
    const disconnectChain = () => chain.forEach((n) => n?.disconnect());
    const sources = [...this.voices.map((v) => v.source)];
    if (this.loopSource) sources.push(this.loopSource);
    this.loopSource = null;
    if (this.looper) {
      this.looper.stop(fadeSec);
      this.looper = null;
    }
    if (sources.length === 0) {
      disconnectChain();
      return;
    }
    let pending = sources.length;
    for (const source of sources) {
      const prev = source.onended;
      source.onended = (e) => {
        if (typeof prev === 'function') prev.call(source, e);
        source.disconnect();
        if (--pending === 0) disconnectChain();
      };
      source.stop(now + fadeSec);
    }
  }

  private applyFadeIn() {
    const fade = this.fadeIn;
    if (fade === 'hold') return;
    const now = this.ctx.currentTime;
    if (fade.equalPower) {
      equalPowerFade(this.voiceGain.gain, 1, now, fade.sec);
    } else {
      this.voiceGain.gain.setValueAtTime(0, now);
      this.voiceGain.gain.linearRampToValueAtTime(1, now + fade.sec);
    }
  }

  private startLoop() {
    if (!this.buffer) return;
    const cfg = this.loopConfig();
    const randomStart = this.config.mode.type === 'loop' && this.config.mode.randomStart !== false;
    const offset = randomStart
      ? cfg.loopStart + this.deps.rng() * (cfg.loopEnd - cfg.loopStart)
      : cfg.trackStart;
    if (cfg.mode === 'crossfade' && cfg.crossfadeSec > 0.005) {
      const looper = new CrossfadeLoop(this.deps, this.voiceGain);
      looper.start(this.buffer, cfg, offset);
      this.looper = looper;
      return;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = cfg.loopStart;
    source.loopEnd = cfg.loopEnd;
    source.connect(this.voiceGain);
    source.start(this.ctx.currentTime, offset);
    this.loopSource = source;
  }

  /** The loop settings of this layer: the sound's descriptor overridden by the layer's own. */
  private loopConfig(): LoopConfig {
    const mode = this.config.mode;
    return resolveLoopConfig(
      {
        trackStart: this.descriptor?.trackStart,
        trackEnd: this.descriptor?.trackEnd,
        loopStart: this.descriptor?.loopStart,
        loopEnd: this.descriptor?.loopEnd,
        mode: this.descriptor?.loopMode,
        crossfadeSec: this.descriptor?.crossfadeSec,
        ...(mode.loop ?? {}),
      },
      this.buffer?.duration ?? 0,
    );
  }

  /** Applies the current loop settings to what plays, switching gapless/crossfade if needed. */
  private syncLoop() {
    if (!this.started || !this.buffer) return;
    const cfg = this.loopConfig();
    const crossfade = cfg.mode === 'crossfade' && cfg.crossfadeSec > 0.005;
    if (crossfade && this.looper) {
      this.looper.update(cfg);
      return;
    }
    if (!crossfade && this.loopSource) {
      this.loopSource.loopStart = cfg.loopStart;
      this.loopSource.loopEnd = cfg.loopEnd;
      return;
    }
    // The loop kind changed: restart the loop quickly with the new settings.
    if (this.looper) {
      this.looper.stop(VOICE_STEAL_FADE_SEC);
      this.looper = null;
    }
    if (this.loopSource) {
      const old = this.loopSource;
      this.loopSource = null;
      old.onended = () => old.disconnect();
      old.stop(this.ctx.currentTime + VOICE_STEAL_FADE_SEC);
    }
    if (this.config.mode.type === 'loop') this.startLoop();
  }

  // undefined

  private between(min: number, max: number) {
    return min + this.deps.rng() * (max - min);
  }

  /**
   * Queue the next event a random pause after `from` (audio-clock seconds: when the
   * previous play ends) and arm a timer for it.
   */
  private scheduleNext(from: number) {
    const mode = this.config.mode;
    if (mode.type !== 'recurring' || this.stopped || !this.buffer) return;
    const min = Math.max(MIN_RECURRING_INTERVAL_SEC, mode.minInterval);
    const delay = this.between(min, Math.max(min, mode.maxInterval));
    const now = this.ctx.currentTime;
    let when = from + delay;
    // Timer was throttled past the next slot: skip missed events instead of bursting.
    if (when < now) when = now + delay;
    this.queueEvent(when);
    this.armTimer(when);
  }

  private armTimer(when: number) {
    this.nextWhen = when;
    const ms = Math.max(0, (when - this.ctx.currentTime) * 1000);
    this.nextTimer = this.deps.timers.setTimeout(() => this.onTimer(), ms);
  }

  private onTimer() {
    this.nextTimer = null;
    if (this.stopped || this.nextWhen === null) return;
    // Audio clock behind (context suspended / locked): wait, don't queue more events.
    if (this.ctx.currentTime < this.nextWhen - TIMER_SLACK_SEC) {
      this.armTimer(this.nextWhen);
      return;
    }
    // The pause runs from the end of the play that just started, so plays never overlap.
    const trackLen = this.loopConfig().trackEnd - this.loopConfig().trackStart;
    this.scheduleNext(this.nextWhen + trackLen);
  }

  private queueEvent(when: number) {
    const mode = this.config.mode;
    if (mode.type !== 'recurring' || !this.buffer) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    const [jMin, jMax] = mode.volumeJitter ?? [1, 1];
    gain.gain.value = this.between(jMin, jMax);
    const nodes: AudioNode[] = [gain];
    let tail: AudioNode = gain;
    if (mode.panJitter && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = this.between(-mode.panJitter, mode.panJitter);
      tail = tail.connect(panner);
      nodes.push(panner);
    }
    tail.connect(this.voiceGain);

    while (this.voices.length >= RECURRING_MAX_OVERLAP) {
      const oldest = this.voices.shift()!;
      const g = (oldest.nodes[0] as GainNode).gain;
      g.setValueAtTime(g.value, when);
      g.linearRampToValueAtTime(0, when + VOICE_STEAL_FADE_SEC);
      oldest.source.stop(when + VOICE_STEAL_FADE_SEC);
    }

    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(gain);
    const voice: Voice = { source, nodes };
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      nodes.forEach((n) => n.disconnect());
    };
    // Each play runs the track region: from the track start to the track end.
    const track = this.loopConfig();
    source.start(
      when,
      track.trackStart,
      Math.max(MIN_RECURRING_INTERVAL_SEC, track.trackEnd - track.trackStart),
    );
    this.voices.push(voice);
  }

  private targetGain() {
    return sliderToGain(this.config.volume) * dbToGain(this.descriptor?.gainDb ?? 0);
  }
}

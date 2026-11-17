import { clamp, dbToGain, fadeTo, rampTo, sliderToGain } from '../params';
import type { ActiveOneshot, OneshotHandle, SoundDescriptor, SoundId } from '../types';

export const DEFAULT_MAX_ONESHOT_VOICES = 8;
export const DEFAULT_MAX_INSTANCES = 3;
export const STEAL_FADE_SEC = 0.03;

interface OneshotVoice {
  id: string;
  soundId: SoundId;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  stopping: boolean;
  startedAt: number;
  durationSec: number;
}

export interface OneshotBusCallbacks {
  /** Wall clock in epoch ms, for `ActiveOneshot.startedAt`. */
  now(): number;
  onVoicesChange(voices: ActiveOneshot[]): void;
  onStolen(soundId: SoundId): void;
  onVoiceEnded(soundId: SoundId): void;
}

/** One-shots above the mix: source → voice gain → [panner] → oneshot gain → master. */
export class OneshotBus {
  readonly gain: GainNode;
  private voices: OneshotVoice[] = [];
  private nextId = 0;

  constructor(
    private ctx: BaseAudioContext,
    destination: AudioNode,
    private maxVoices: number,
    private cb: OneshotBusCallbacks,
  ) {
    this.gain = ctx.createGain();
    this.gain.connect(destination);
  }

  get activeCount() {
    return this.voices.filter((v) => !v.stopping).length;
  }

  private notify() {
    this.cb.onVoicesChange(
      this.voices
        .filter((v) => !v.stopping)
        .map((v) => ({
          id: v.id,
          soundId: v.soundId,
          startedAt: v.startedAt,
          durationSec: v.durationSec,
        })),
    );
  }

  setVolume(v: number) {
    rampTo(this.gain.gain, sliderToGain(v), this.ctx.currentTime);
  }

  setVoiceVolume(voiceId: string, v: number) {
    const voice = this.voices.find((voice) => voice.id === voiceId);
    if (voice && !voice.stopping) {
      const clamped = Math.max(0, Math.min(1, v));
      rampTo(voice.gain.gain, sliderToGain(clamped), this.ctx.currentTime);
    }
  }

  play(
    descriptor: SoundDescriptor,
    buffer: AudioBuffer,
    opts: { volume?: number; pan?: number },
  ): OneshotHandle {
    const maxInstances = descriptor.maxInstances ?? DEFAULT_MAX_INSTANCES;
    const live = () => this.voices.filter((v) => !v.stopping);
    const sameSound = live().filter((v) => v.soundId === descriptor.id);
    if (sameSound.length >= maxInstances) this.steal(sameSound[0]);
    else if (live().length >= this.maxVoices) this.steal(live()[0]);

    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = sliderToGain(opts.volume ?? 1) * dbToGain(descriptor.gainDb ?? 0);
    let panner: StereoPannerNode | null = null;
    if (opts.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.value = clamp(opts.pan, -1, 1);
      gain.connect(panner).connect(this.gain);
    } else {
      gain.connect(this.gain);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const voice: OneshotVoice = {
      id: `oneshot-${++this.nextId}`,
      soundId: descriptor.id,
      source,
      gain,
      panner,
      stopping: false,
      startedAt: this.cb.now(),
      durationSec: buffer.duration,
    };
    source.onended = () => {
      this.voices = this.voices.filter((v) => v !== voice);
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
      this.cb.onVoiceEnded(voice.soundId);
      this.notify();
    };
    source.start(ctx.currentTime);
    this.voices.push(voice);
    this.notify();
    return {
      id: voice.id,
      stop: (fadeSec = STEAL_FADE_SEC) => this.fadeOut(voice, fadeSec),
      setVolume: (v: number) => {
        if (!voice.stopping) {
          const clamped = Math.max(0, Math.min(1, v));
          rampTo(voice.gain.gain, sliderToGain(clamped), this.ctx.currentTime);
        }
      },
    };
  }

  stopAll(fadeSec = STEAL_FADE_SEC) {
    for (const v of [...this.voices]) this.fadeOut(v, fadeSec);
  }

  private steal(voice: OneshotVoice) {
    this.fadeOut(voice, STEAL_FADE_SEC);
    this.cb.onStolen(voice.soundId);
  }

  private fadeOut(voice: OneshotVoice, fadeSec: number) {
    if (voice.stopping) return;
    voice.stopping = true;
    const now = this.ctx.currentTime;
    fadeTo(voice.gain.gain, 0, now, fadeSec);
    voice.source.stop(now + fadeSec);
    this.notify();
  }
}

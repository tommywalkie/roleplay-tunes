/**
 * Minimal Web Audio fakes for unit tests (node environment, no real audio).
 * - Time only moves with `ctx.advance(sec)`; sources whose stop time has passed fire `onended`.
 * - AudioParams record automation and can evaluate their value at any time (`valueAt`).
 *
 * Usage: `createAudioEngine({ createContext: () => fake.asAudioContext(), ... })`.
 */

type ParamEvent =
  | { type: 'set'; time: number; value: number }
  | { type: 'linear'; time: number; value: number }
  | { type: 'target'; time: number; value: number; timeConstant: number }
  | { type: 'curve'; time: number; duration: number; curve: number[] };

export class FakeAudioParam {
  events: ParamEvent[] = [];
  private base: number;

  constructor(
    private ctx: FakeAudioContext,
    readonly defaultValue: number,
  ) {
    this.base = defaultValue;
  }

  get value() {
    return this.valueAt(this.ctx.currentTime);
  }

  set value(v: number) {
    if (this.events.length === 0) this.base = v;
    else this.setValueAtTime(v, this.ctx.currentTime);
  }

  setValueAtTime(value: number, time: number) {
    return this.insert({ type: 'set', time, value });
  }

  linearRampToValueAtTime(value: number, time: number) {
    return this.insert({ type: 'linear', time, value });
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    // Approximated as linear: tests assert targets/times, not curve shape.
    return this.insert({ type: 'linear', time, value });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number) {
    return this.insert({ type: 'target', time, value, timeConstant });
  }

  setValueCurveAtTime(values: ArrayLike<number>, time: number, duration: number) {
    return this.insert({ type: 'curve', time, duration, curve: Array.from(values) });
  }

  cancelScheduledValues(time: number) {
    this.base = this.valueAt(time);
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }

  cancelAndHoldAtTime(time: number) {
    const v = this.valueAt(time);
    this.cancelScheduledValues(time);
    return this.setValueAtTime(v, time);
  }

  /** Evaluate the automation timeline at `t` (seconds). */
  valueAt(t: number): number {
    let value = this.base;
    let time = 0;
    const ev = this.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'linear') {
        if (t < e.time) {
          return t <= time ? value : value + ((e.value - value) * (t - time)) / (e.time - time);
        }
        value = e.value;
        time = e.time;
        continue;
      }
      if (e.time > t) break;
      if (e.type === 'set') {
        value = e.value;
        time = e.time;
      } else if (e.type === 'target') {
        const next = ev[i + 1];
        const end = next && next.time <= t ? next.time : t;
        value = e.value + (value - e.value) * Math.exp(-(end - e.time) / e.timeConstant);
        time = end;
      } else {
        const end = e.time + e.duration;
        const last = e.curve.length - 1;
        if (t < end) {
          const pos = ((t - e.time) / e.duration) * last;
          const i0 = Math.floor(pos);
          const i1 = Math.min(last, i0 + 1);
          return e.curve[i0] + (e.curve[i1] - e.curve[i0]) * (pos - i0);
        }
        value = e.curve[last];
        time = end;
      }
    }
    return value;
  }

  private insert(e: ParamEvent) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
    return this;
  }
}

export class FakeAudioNode {
  readonly outputs = new Set<FakeAudioNode | FakeAudioParam>();

  constructor(
    readonly context: FakeAudioContext,
    readonly kind: string,
  ) {
    context.nodes.push(this);
  }

  connect<T extends FakeAudioNode | FakeAudioParam>(destination: T): T {
    this.outputs.add(destination);
    return destination;
  }

  disconnect(destination?: FakeAudioNode | FakeAudioParam) {
    if (destination) this.outputs.delete(destination);
    else this.outputs.clear();
  }

  /** True if any path of connections leads to `target`. */
  isConnectedTo(target: FakeAudioNode, seen = new Set<FakeAudioNode>()): boolean {
    for (const out of this.outputs) {
      if (out === target) return true;
      if (out instanceof FakeAudioNode && !seen.has(out)) {
        seen.add(out);
        if (out.isConnectedTo(target, seen)) return true;
      }
    }
    return false;
  }
}

export class FakeGainNode extends FakeAudioNode {
  readonly gain: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'gain');
    this.gain = new FakeAudioParam(ctx, 1);
  }
}

export class FakeStereoPannerNode extends FakeAudioNode {
  readonly pan: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'stereoPanner');
    this.pan = new FakeAudioParam(ctx, 0);
  }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
  readonly threshold: FakeAudioParam;
  readonly knee: FakeAudioParam;
  readonly ratio: FakeAudioParam;
  readonly attack: FakeAudioParam;
  readonly release: FakeAudioParam;
  constructor(ctx: FakeAudioContext) {
    super(ctx, 'dynamicsCompressor');
    this.threshold = new FakeAudioParam(ctx, -24);
    this.knee = new FakeAudioParam(ctx, 30);
    this.ratio = new FakeAudioParam(ctx, 12);
    this.attack = new FakeAudioParam(ctx, 0.003);
    this.release = new FakeAudioParam(ctx, 0.25);
  }
}

export class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private data: Float32Array<ArrayBuffer>[];

  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length = opts.length;
    this.sampleRate = opts.sampleRate;
    this.data = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length));
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number) {
    return this.data[channel];
  }

  copyToChannel(source: Float32Array, channel: number, offset = 0) {
    this.data[channel].set(source, offset);
  }

  copyFromChannel(dest: Float32Array, channel: number, offset = 0) {
    dest.set(this.data[channel].subarray(offset, offset + dest.length));
  }
}

export class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate: FakeAudioParam;
  onended: (() => void) | null = null;
  started: { when: number; offset: number } | null = null;
  stopTime: number | null = null;
  ended = false;

  constructor(ctx: FakeAudioContext) {
    super(ctx, 'bufferSource');
    this.playbackRate = new FakeAudioParam(ctx, 1);
  }

  start(when = 0, offset = 0) {
    if (this.started) throw new Error('InvalidStateError: start() called twice');
    this.started = { when, offset };
  }

  stop(when = 0) {
    if (!this.started) throw new Error('InvalidStateError: stop() before start()');
    this.stopTime = when;
  }

  /** Time at which this source ends on its own (non-looping), or stop time. */
  get endTime(): number | null {
    if (!this.started) return null;
    const natural =
      !this.loop && this.buffer
        ? this.started.when + this.buffer.duration - this.started.offset
        : Infinity;
    return Math.min(natural, this.stopTime ?? Infinity);
  }
}

export interface FakeAudioContextOptions {
  sampleRate?: number;
  /** Initial state. Real browsers start 'suspended' without a user gesture. */
  state?: AudioContextState;
  /** Simulate autoplay policy rejecting resume(). */
  resumeRejects?: boolean;
  /** Custom decoder; default reads buffers produced by `encodeFakeAudio`. */
  decode?: (data: ArrayBuffer, ctx: FakeAudioContext) => FakeAudioBuffer;
}

export class FakeAudioContext {
  readonly sampleRate: number;
  readonly nodes: FakeAudioNode[] = [];
  readonly destination: FakeAudioNode;
  state: AudioContextState | 'interrupted';
  onstatechange: (() => void) | null = null;
  resumeRejects: boolean;
  decodeCount = 0;
  private time = 0;
  private decode: NonNullable<FakeAudioContextOptions['decode']>;

  constructor(opts: FakeAudioContextOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 48000;
    this.state = opts.state ?? 'suspended';
    this.resumeRejects = opts.resumeRejects ?? false;
    this.decode = opts.decode ?? decodeFakeAudio;
    this.destination = new FakeAudioNode(this, 'destination');
  }

  get currentTime() {
    return this.time;
  }

  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  /** Advance the audio clock and fire `onended` for sources that finished. */
  advance(sec: number) {
    if (this.state === 'running') this.time += sec;
    for (const s of this.sources()) {
      const end = s.endTime;
      if (!s.ended && end !== null && end <= this.time) {
        s.ended = true;
        s.onended?.();
      }
    }
  }

  sources(): FakeAudioBufferSourceNode[] {
    return this.nodes.filter((n): n is FakeAudioBufferSourceNode => n.kind === 'bufferSource');
  }

  /** Sources started and not ended (ignores the 1-sample unlock buffer). */
  playingSources(): FakeAudioBufferSourceNode[] {
    return this.sources().filter((s) => s.started && !s.ended && s.buffer && s.buffer.length > 1);
  }

  gains(): FakeGainNode[] {
    return this.nodes.filter((n): n is FakeGainNode => n.kind === 'gain');
  }

  createGain() {
    return new FakeGainNode(this);
  }

  createBufferSource() {
    return new FakeAudioBufferSourceNode(this);
  }

  createStereoPanner() {
    return new FakeStereoPannerNode(this);
  }

  createDynamicsCompressor() {
    return new FakeDynamicsCompressorNode(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    return new FakeAudioBuffer({ numberOfChannels, length, sampleRate });
  }

  async decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    this.decodeCount++;
    return this.decode(data, this);
  }

  async resume() {
    if (this.state === 'closed') throw new Error('InvalidStateError: closed');
    if (this.resumeRejects) throw new Error('NotAllowedError: resume() requires a user gesture');
    this.setState('running');
  }

  async suspend() {
    if (this.state !== 'closed') this.setState('suspended');
  }

  async close() {
    this.setState('closed');
  }

  /** Safari's non-standard 'interrupted' state (phone call, Siri...). */
  simulateInterruption() {
    this.setState('interrupted');
  }

  private setState(state: AudioContextState | 'interrupted') {
    if (this.state === state) return;
    this.state = state;
    this.onstatechange?.();
  }
}

/** Encodes a fake "audio file" understood by the default fake decoder. */
export function encodeFakeAudio(opts: { seconds: number; channels?: number }): ArrayBuffer {
  return new Float64Array([opts.seconds, opts.channels ?? 2]).buffer;
}

export function decodeFakeAudio(data: ArrayBuffer, ctx: FakeAudioContext): FakeAudioBuffer {
  if (data.byteLength !== 16) throw new Error('EncodingError: not a fake audio file');
  const [seconds, channels] = new Float64Array(data);
  return new FakeAudioBuffer({
    numberOfChannels: channels,
    length: Math.round(seconds * ctx.sampleRate),
    sampleRate: ctx.sampleRate,
  });
}

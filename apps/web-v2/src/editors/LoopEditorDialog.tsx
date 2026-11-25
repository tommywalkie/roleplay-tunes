import type { LoopPreviewHandle } from '@dnd/audio-engine';

import {
  MAX_CROSSFADE_SEC,
  MIN_CROSSFADE_LOOP_SEC,
  resolveLoopSettings,
  type LoopSettings,
  type PlayMode,
  type Sound,
} from '@dnd/shared';

import { LocateFixed, Pause, Play, Repeat, SkipBack, Square } from 'lucide-react';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { usePlayer } from '../audio/player';

import { Dialog } from '../components/Dialog';

import { Button, Field, IconButton, Segmented, cx } from '../components/ui';

import { useI18n } from '../i18n';

import type { MessageKey } from '../i18n/en';

type Marker = 'trackStartSec' | 'loopStartSec' | 'loopEndSec' | 'trackEndSec';

const MARKERS: Marker[] = ['trackStartSec', 'loopStartSec', 'loopEndSec', 'trackEndSec'];

/** The marker chips, two per row: the loop pair, then the track pair. */
const CHIP_ORDER: Marker[] = ['loopStartSec', 'loopEndSec', 'trackStartSec', 'trackEndSec'];

const MARKER_LABEL: Record<Marker, MessageKey> = {
  trackStartSec: 'loop.trackStart',
  loopStartSec: 'loop.loopStart',
  loopEndSec: 'loop.loopEnd',
  trackEndSec: 'loop.trackEnd',
};

const MARKER_TAG: Record<Marker, MessageKey> = {
  trackStartSec: 'loop.tag.trackStart',
  loopStartSec: 'loop.tag.loopStart',
  loopEndSec: 'loop.tag.loopEnd',
  trackEndSec: 'loop.tag.trackEnd',
};

const SET_LABEL: Record<Marker, MessageKey> = {
  trackStartSec: 'loop.setTrackStart',
  loopStartSec: 'loop.setLoopStart',
  loopEndSec: 'loop.setLoopEnd',
  trackEndSec: 'loop.setTrackEnd',
};

/** Smallest window the zoom allows, in seconds. */
const MIN_VIEW_SEC = 2;

/** Waveform bars keep one width and one gap at every zoom: zooming changes how many show. */
const BAR_W = 2;
const BAR_GAP = 2;
const BAR_STEP = BAR_W + BAR_GAP;

/** Peak buckets per second of the narrowest window, so the deepest zoom still has detail. */
const PEAKS_PER_VIEW = 400;
const MAX_PEAKS = 200_000;

/** A pointer that moves less than this (px) is a tap, not a drag. */
const TAP_SLOP_PX = 4;

/**
 * Fixed timeline colors, one per marker: track start blue with its tag at the bottom,
 * loop start/end amber with tags on top, track end purple with its tag at the bottom,
 * playhead red with its tag on top.
 */
const MARKER_COLOR: Record<Marker, string> = {
  trackStartSec: '#4d8dff',
  loopStartSec: '#f0a23b',
  loopEndSec: '#f0a23b',
  trackEndSec: '#a855f7',
};
const MARKER_TAG_SIDE: Record<Marker, 'top' | 'bottom'> = {
  trackStartSec: 'bottom',
  loopStartSec: 'top',
  loopEndSec: 'top',
  trackEndSec: 'bottom',
};
const PLAYHEAD_COLOR = '#e5484d';
/** Region washes and waveform bar colors. */
const REGION = {
  lead: { wash: 'rgb(77 141 255 / 0.16)', bar: '#4d8dff' },
  loop: { wash: 'rgb(240 162 59 / 0.18)', bar: '#f0a23b' },
  tail: { wash: 'rgb(168 85 247 / 0.16)', bar: '#c26df0' },
  outside: { wash: 'rgb(0 0 0 / 0.45)', bar: '#8a847a' },
};
/** The volume line drawn over the waveform, and the shade above it. */
const ENVELOPE_LINE = 'rgb(239 233 222 / 0.85)';
const ENVELOPE_SHADE = 'rgb(18 17 15 / 0.5)';

/** `mm:ss:cc` (minutes, seconds, hundredths), for marker times and the playhead tag. */
export function clock(sec: number): string {
  const total = Math.round(Math.max(0, sec) * 100);
  const m = Math.floor(total / 6000);
  const s = Math.floor((total % 6000) / 100);
  const c = total % 100;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(m)}:${two(s)}:${two(c)}`;
}

/**
 * Reads a typed time back to seconds: `mm:ss:cc`, `mm:ss` or bare seconds. Minutes may go
 * past 99; seconds stay under 60 and hundredths under 100. Null when it does not read.
 */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [m, s, c] = parts.length === 1 ? [0, Number(parts[0]), 0] : parts.map(Number);
  if (parts.length > 1 && s >= 60) return null;
  if ((c ?? 0) >= 100 || (parts[2] !== undefined && parts[2].length > 2)) return null;
  return m * 60 + s + (c ?? 0) / 100;
}

/** Highest peak over a time range, from peaks spread evenly over the whole track. */
function peakOver(peaks: Float32Array, durationSec: number, t0: number, t1: number): number {
  const n = peaks.length;
  const i0 = Math.max(0, Math.floor((t0 / durationSec) * n));
  const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 / durationSec) * n)));
  let max = 0;
  for (let i = i0; i < i1; i++) if (peaks[i] > max) max = peaks[i];
  return max;
}

function regionAt(d: LoopSettings, t: number) {
  if (t < d.trackStartSec || t > d.trackEndSec) return REGION.outside;
  if (t >= d.loopStartSec && t <= d.loopEndSec) return REGION.loop;
  return t < d.loopStartSec ? REGION.lead : REGION.tail;
}

/** Draws bars over `[start, start + len]` seconds, anchored in time so panning never shimmers. */
function drawBars(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  durationSec: number,
  draft: LoopSettings,
  start: number,
  len: number,
  w: number,
  h: number,
  alpha: number,
) {
  const barSec = (len / w) * BAR_STEP;
  const mid = h / 2;
  const k0 = Math.floor(start / barSec);
  const k1 = Math.ceil((start + len) / barSec);
  for (let k = k0; k < k1; k++) {
    const t0 = k * barSec;
    if (t0 >= durationSec) break;
    const t1 = Math.min(durationSec, t0 + barSec);
    const region = regionAt(draft, (t0 + t1) / 2);
    ctx.fillStyle = region.bar;
    ctx.globalAlpha = region === REGION.outside ? alpha * 0.35 : alpha;
    const bh = Math.max(1, peakOver(peaks, durationSec, t0, t1) * (h - 4));
    ctx.fillRect(((t0 - start) / len) * w, mid - bh / 2, BAR_W, bh);
  }
  ctx.globalAlpha = 1;
}

/**
 * The gain at `t` for the way the sound plays. A loop pass: silent outside the track and
 * after the loop, full in between, and with a crossfade the equal-power fade-out over the
 * last `crossfadeSec` of the loop (the matching fade-in at the loop start is `fadeInAt`).
 * Once or with random gaps: the whole track, track start to track end, at full volume.
 */
function gainAt(d: LoopSettings, cf: number, t: number, looping: boolean): number {
  if (!looping) return t < d.trackStartSec || t > d.trackEndSec ? 0 : 1;
  if (t < d.trackStartSec || t > d.loopEndSec) return 0;
  if (cf > 0 && t > d.loopEndSec - cf) {
    return Math.cos((((t - (d.loopEndSec - cf)) / cf) * Math.PI) / 2);
  }
  return 1;
}
function fadeInAt(d: LoopSettings, cf: number, t: number): number {
  return Math.sin((((t - d.loopStartSec) / cf) * Math.PI) / 2);
}

/** Volume line over the visible window, with the part above it shaded, like a video editor's. */
function drawEnvelope(
  ctx: CanvasRenderingContext2D,
  draft: LoopSettings,
  start: number,
  len: number,
  w: number,
  h: number,
  looping: boolean,
) {
  const top = 6;
  const bottom = h - 6;
  const yOf = (g: number) => bottom - g * (bottom - top);
  const cf = looping && draft.loopMode === 'crossfade' ? draft.crossfadeSec : 0;
  const curve = (gain: (t: number) => number, x0: number, x1: number) => {
    const pts: [number, number][] = [];
    for (let x = x0; x <= x1; x += 1) pts.push([x, yOf(gain(start + (x / w) * len))]);
    return pts;
  };
  const shadeAndStroke = (pts: [number, number][]) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], 0);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], 0);
    ctx.closePath();
    ctx.fillStyle = ENVELOPE_SHADE;
    ctx.fill();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = ENVELOPE_LINE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  shadeAndStroke(curve((t) => gainAt(draft, cf, t, looping), 0, w));
  // The fade-in of every pass after the first, over the start of the loop.
  if (cf > 0) {
    const x0 = Math.max(0, Math.floor(((draft.loopStartSec - start) / len) * w));
    const x1 = Math.min(w, Math.ceil(((draft.loopStartSec + cf - start) / len) * w));
    if (x1 > x0) shadeAndStroke(curve((t) => fadeInAt(draft, cf, t), x0, x1));
  }
}

/**
 * A time typed as `mm:ss:cc`. It shows the value formatted, keeps what is typed while it has
 * focus, and commits on Enter or when it loses focus; text that does not read goes back.
 */
function TimeInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (sec: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const sec = parseClock(text);
    if (sec !== null) onCommit(sec);
    setText(null);
  };
  return (
    <input
      // No numeric keypad: phone keypads have no colon.
      type="text"
      spellCheck={false}
      autoComplete="off"
      placeholder="00:00:00"
      className="h-full w-full min-w-0 bg-transparent px-2 font-mono text-[13px] leading-5 text-ink tabular-nums outline-none"
      value={text ?? clock(value)}
      aria-label={label}
      title={label}
      onFocus={(e) => e.currentTarget.select()}
      // Digits and colons only: the format is enforced as it is typed.
      onChange={(e) => setText(e.target.value.replace(/[^\d:]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Keep Enter from submitting the dialog: it only sets the time.
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape' && text !== null) {
          e.stopPropagation();
          setText(null);
        }
      }}
    />
  );
}

type Gesture =
  | { kind: 'marker'; marker: Marker | 'playhead' }
  | { kind: 'tap' | 'pan'; x0: number; start0: number }
  | { kind: 'pinch'; d0: number; len0: number; anchor: number };

/**
 * The loop editor: a zoomable, scrollable waveform with four draggable markers (track
 * start, loop start, loop end, track end) and a playhead, each with a tag outside the
 * waveform, a volume line showing the crossfade, an overview strip of the whole track, and
 * a test sequence that can start from the playhead, the track start or the loop start.
 *
 * Gestures on the waveform: tap to place the playhead, drag to scroll, pinch or the wheel
 * to zoom around the pointer, shift + wheel or a sideways swipe to scroll. Markers and the
 * playhead move by their tag or line. `onSave` hands the settings back to the caller.
 */
export function LoopEditorDialog({
  sound,
  initial,
  mode = 'loop',
  live = false,
  onSave,
  onClose,
}: {
  sound: Sound;
  /**
   * How the sound plays where these settings apply. Once and random gaps play track start
   * to track end, so the volume line shows that; a loop shows the loop pass.
   */
  mode?: PlayMode;
  /** The settings as they stand now (the sound's own, a mix item's, or a playing layer's). */
  initial: LoopSettings;
  /** Changes apply to a playing sound only and are not saved: say so. */
  live?: boolean;
  onSave: (loop: LoopSettings) => void;
  onClose: () => void;
}) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const durationSec = sound.durationSec;
  const looping = mode === 'loop';
  const [draft, setDraft] = useState<LoopSettings>(() =>
    resolveLoopSettings({ durationSec, ...initial }),
  );
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [testing, setTesting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  /** Visible window of the waveform, in seconds. */
  const [view, setView] = useState({ start: 0, end: durationSec });
  const handleRef = useRef<LoopPreviewHandle | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const overviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pointersRef = useRef(new Map<number, number>());
  const overviewGrabRef = useRef<number | null>(null);

  const clamped = (d: LoopSettings) => resolveLoopSettings({ durationSec, ...d });
  const setMarker = (key: Marker, value: number) =>
    setDraft((d) => clamped({ ...d, [key]: value }));

  useEffect(() => {
    let alive = true;
    const buckets = Math.min(
      MAX_PEAKS,
      Math.max(1000, Math.ceil((durationSec / MIN_VIEW_SEC) * PEAKS_PER_VIEW)),
    );
    void player.waveformPeaks(sound.id, buckets).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [player, sound.id, durationSec]);

  // The test sequence never outlives the dialog.
  useEffect(() => () => handleRef.current?.stop(), []);

  // Live-update the running test when the markers, the mode or the crossfade change.
  useEffect(() => {
    if (!testing) return;
    handleRef.current?.update({
      trackStart: draft.trackStartSec,
      trackEnd: draft.trackEndSec,
      loopStart: draft.loopStartSec,
      loopEnd: draft.loopEndSec,
      mode: draft.loopMode,
      crossfadeSec: draft.crossfadeSec,
    });
  }, [draft, testing]);

  // Playhead poll while the test runs.
  useEffect(() => {
    if (!testing) return;
    let raf = 0;
    const poll = () => {
      const h = handleRef.current;
      if (h) setPosition(h.getPosition());
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, [testing]);

  const viewLen = view.end - view.start;
  const viewRef = useRef(view);
  viewRef.current = view;
  const xPct = useCallback(
    (time: number) => ((time - view.start) / viewLen) * 100,
    [view.start, viewLen],
  );

  // Waveform and volume line, over the visible window only.
  useEffect(() => {
    const canvas = canvasRef.current;
    const box = waveRef.current;
    if (!canvas || !box) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (peaks && peaks.length > 0) {
        drawBars(ctx, peaks, durationSec, draft, view.start, viewLen, w, h, 1);
      }
      drawEnvelope(ctx, draft, view.start, viewLen, w, h, looping);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [peaks, draft, view.start, viewLen, durationSec, looping]);

  // Overview strip: the whole track, redrawn only when the waveform or markers change.
  useEffect(() => {
    const canvas = overviewCanvasRef.current;
    const box = overviewRef.current;
    if (!canvas || !box) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (w === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (peaks && peaks.length > 0) {
        drawBars(ctx, peaks, durationSec, draft, 0, durationSec, w, h, 0.55);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [peaks, draft, durationSec]);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = waveRef.current;
      if (!el) return view.start;
      const r = el.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return view.start + f * viewLen;
    },
    [view.start, viewLen],
  );

  /**
   * Zooms the window to `len` seconds, keeping the time `anchor` at the same fraction of the
   * width (0 left, 0.5 middle, 1 right), so the point being zoomed on never drifts. Clamped.
   */
  const zoomTo = useCallback(
    (len: number, anchor: number, frac = 0.5) => {
      const l = Math.min(durationSec, Math.max(MIN_VIEW_SEC, len));
      const start = Math.min(Math.max(anchor - l * frac, 0), durationSec - l);
      setView({ start, end: start + l });
    },
    [durationSec],
  );

  /** Moves the window so it starts at `start` seconds, keeping its length. Clamped. */
  const scrollTo = useCallback(
    (start: number) => {
      const { start: s, end: e } = viewRef.current;
      const l = e - s;
      const next = Math.min(Math.max(start, 0), durationSec - l);
      setView({ start: next, end: next + l });
    },
    [durationSec],
  );

  const movePlayhead = (at: number) => {
    setPosition(at);
    handleRef.current?.seekTo(at);
  };

  const fracAt = (clientX: number) => {
    const el = waveRef.current;
    if (!el) return 0.5;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const startPinch = () => {
    const [a, b] = [...pointersRef.current.values()];
    const { start, end } = viewRef.current;
    const len = end - start;
    const mid = (a + b) / 2;
    gestureRef.current = {
      kind: 'pinch',
      d0: Math.max(10, Math.abs(a - b)),
      len0: len,
      anchor: start + fracAt(mid) * len,
    };
  };

  const onWavePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const hit = (e.target as HTMLElement).closest('[data-marker]') as HTMLElement | null;
    const marker = hit?.dataset.marker as Marker | 'playhead' | undefined;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (marker && pointersRef.current.size === 0) {
      gestureRef.current = { kind: 'marker', marker };
      if (marker === 'playhead') movePlayhead(timeAt(e.clientX));
      else setMarker(marker, timeAt(e.clientX));
      return;
    }
    pointersRef.current.set(e.pointerId, e.clientX);
    if (pointersRef.current.size === 1) {
      gestureRef.current = { kind: 'tap', x0: e.clientX, start0: viewRef.current.start };
    } else if (pointersRef.current.size === 2) {
      startPinch();
    }
  };

  const onWavePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.kind === 'marker') {
      const at = timeAt(e.clientX);
      if (g.marker === 'playhead') movePlayhead(at);
      else setMarker(g.marker, at);
      return;
    }
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, e.clientX);
    const w = waveRef.current?.clientWidth ?? 1;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointersRef.current.values()];
      if (b === undefined) return;
      const d = Math.max(10, Math.abs(a - b));
      zoomTo((g.len0 * g.d0) / d, g.anchor, fracAt((a + b) / 2));
      return;
    }
    const dx = e.clientX - g.x0;
    if (g.kind === 'tap' && Math.abs(dx) < TAP_SLOP_PX) return;
    const len = viewRef.current.end - viewRef.current.start;
    gestureRef.current = { ...g, kind: 'pan' };
    scrollTo(g.start0 - (dx / w) * len);
  };

  const onWavePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (g?.kind === 'marker') {
      gestureRef.current = null;
      // Snap loop points to a zero crossing so the seam stays click-free.
      if (g.marker === 'loopStartSec' || g.marker === 'loopEndSec') {
        const marker = g.marker;
        void player
          .snapToZero(sound.id, timeAt(e.clientX))
          .then((snapped) => setMarker(marker, snapped));
      }
      return;
    }
    if (!pointersRef.current.delete(e.pointerId)) return;
    if (g?.kind === 'tap' && e.type === 'pointerup') movePlayhead(timeAt(e.clientX));
    const rest = [...pointersRef.current.values()];
    // Lifting one finger of a pinch carries on as a scroll with the other.
    gestureRef.current =
      rest.length === 1 ? { kind: 'pan', x0: rest[0], start0: viewRef.current.start } : null;
  };

  // Wheel: zoom around the pointer; shift + wheel or a sideways swipe scrolls instead.
  // Non-passive so the dialog does not scroll under it.
  const timeAtRef = useRef(timeAt);
  timeAtRef.current = timeAt;
  useEffect(() => {
    const el = waveRef.current?.parentElement;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const wave = waveRef.current;
      if (!wave) return;
      e.preventDefault();
      const { start, end } = viewRef.current;
      const len = end - start;
      const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (sideways) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        scrollTo(start + (delta / wave.clientWidth) * len);
        return;
      }
      const r = wave.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      zoomTo(len * (e.deltaY > 0 ? 1.25 : 0.8), timeAtRef.current(e.clientX), frac);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollTo, zoomTo]);

  // Overview strip: drag the window box to scroll; a tap elsewhere centers the window there.
  const overviewTime = (clientX: number) => {
    const el = overviewRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * durationSec;
  };
  const onOverviewPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = overviewTime(e.clientX);
    const { start, end } = viewRef.current;
    if (at >= start && at <= end) {
      overviewGrabRef.current = at - start;
    } else {
      overviewGrabRef.current = (end - start) / 2;
      scrollTo(at - overviewGrabRef.current);
    }
  };
  const onOverviewPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (overviewGrabRef.current === null) return;
    scrollTo(overviewTime(e.clientX) - overviewGrabRef.current);
  };
  const onOverviewPointerUp = () => {
    overviewGrabRef.current = null;
  };

  const startTest = (from: 'marker' | 'track' | 'loop') => {
    handleRef.current?.stop();
    const handle = player.previewLoopTest(sound, draft);
    handleRef.current = handle;
    setTesting(true);
    setPaused(false);
    if (from === 'track') handle.playFromStart();
    else if (from === 'loop') handle.seekTo(draft.loopStartSec);
    else handle.seekTo(position);
  };
  /** One button: play from the playhead, pause, resume where it paused. */
  const playPause = () => {
    const h = handleRef.current;
    if (!testing || !h) {
      startTest('marker');
    } else if (paused) {
      h.resume();
      setPaused(false);
    } else {
      h.pause();
      setPaused(true);
    }
  };
  const stopTest = () => {
    handleRef.current?.stop();
    handleRef.current = null;
    setTesting(false);
    setPaused(false);
  };

  const loopLen = draft.loopEndSec - draft.loopStartSec;
  const maxCrossfade = Math.min(MAX_CROSSFADE_SEC, loopLen / 2);
  const showCrossfade = draft.loopMode === 'crossfade' && loopLen >= MIN_CROSSFADE_LOOP_SEC;
  const playing = testing && !paused;

  const apply = () => {
    stopTest();
    onSave(clamped(draft));
    onClose();
  };
  const close = () => {
    stopTest();
    onClose();
  };

  const inView = (x: number) => x >= 0 && x <= 100;
  const playheadX = xPct(position);

  return (
    <Dialog
      title={t('loop.title')}
      onClose={close}
      onSubmit={apply}
      footer={
        <>
          <Button onClick={close} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-ink-3">
        {live ? `${t('loop.liveHint')}. ${t('loop.hint')}` : t('loop.hint')}
      </p>

      <div className="flex flex-col gap-2">
        {/* Waveform, with every tag on a row above or below it, never clipped inside the box. */}
        {/* Tag rows: playhead on top (behind), loop tags under it (in front), track tags below. */}
        <div
          className="relative touch-none pt-12 pb-6 select-none"
          onPointerDown={onWavePointerDown}
          onPointerMove={onWavePointerMove}
          onPointerUp={onWavePointerUp}
          onPointerCancel={onWavePointerUp}
          role="group"
          aria-label={t('loop.waveform')}
        >
          {MARKERS.map((m) => {
            const x = xPct(draft[m]);
            if (!inView(x)) return null;
            return (
              <span
                key={m}
                data-marker={m}
                role="slider"
                aria-label={t(MARKER_LABEL[m])}
                aria-valuemin={0}
                aria-valuemax={Math.round(durationSec)}
                aria-valuenow={Math.round(draft[m])}
                aria-valuetext={duration(draft[m])}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    setMarker(m, draft[m] + (e.key === 'ArrowRight' ? 0.1 : -0.1));
                  }
                }}
                className={cx(
                  'absolute z-20 w-8 -translate-x-1/2 cursor-ew-resize rounded-[4px] py-0.5 text-center font-mono text-[11px] leading-4 font-medium text-white',
                  MARKER_TAG_SIDE[m] === 'top' ? 'top-6' : 'bottom-0',
                )}
                style={{ left: `${x}%`, background: MARKER_COLOR[m] }}
              >
                {t(MARKER_TAG[m])}
              </span>
            );
          })}
          {inView(playheadX) && (
            // Joins the playhead tag to its line, passing behind the loop tags.
            <span
              className="absolute top-5 z-10 h-7 w-[2px] -translate-x-1/2"
              style={{ left: `${playheadX}%`, background: PLAYHEAD_COLOR }}
              aria-hidden
            />
          )}
          {inView(playheadX) && (
            <span
              data-marker="playhead"
              role="slider"
              aria-label={t('loop.playhead')}
              aria-valuemin={0}
              aria-valuemax={Math.round(durationSec)}
              aria-valuenow={Math.round(position)}
              aria-valuetext={duration(position)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  movePlayhead(
                    Math.min(durationSec, Math.max(0, position + (e.key === 'ArrowRight' ? 0.1 : -0.1))),
                  );
                }
              }}
              className="absolute top-0 z-10 -translate-x-1/2 cursor-ew-resize rounded-[4px] px-1.5 py-0.5 font-mono text-[11px] leading-4 font-medium text-white tabular-nums"
              style={{ left: `${playheadX}%`, background: PLAYHEAD_COLOR }}
            >
              {clock(position)}
            </span>
          )}
          <div
            ref={waveRef}
            // A ring, not a border: it takes no room, so the tags above and the lines inside
            // share one coordinate system and the playhead line meets its tag exactly.
            className="relative isolate h-28 cursor-grab overflow-hidden rounded-xl bg-deep ring-1 ring-line active:cursor-grabbing"
          >
            {/* Region washes, clamped to the visible window so none spills when zoomed in. */}
            {(
              [
                [0, draft.trackStartSec, REGION.outside.wash],
                [draft.trackStartSec, draft.loopStartSec, REGION.lead.wash],
                [draft.loopStartSec, draft.loopEndSec, REGION.loop.wash],
                [draft.loopEndSec, draft.trackEndSec, REGION.tail.wash],
                [draft.trackEndSec, durationSec, REGION.outside.wash],
              ] as const
            ).map(([a, b, wash], i) => {
              const left = Math.min(100, Math.max(0, xPct(a)));
              const right = Math.min(100, Math.max(0, xPct(b)));
              if (right <= left) return null;
              return (
                <div
                  key={i}
                  className="absolute inset-y-0"
                  style={{ left: `${left}%`, width: `${right - left}%`, background: wash }}
                  aria-hidden
                />
              );
            })}
            <canvas ref={canvasRef} className="absolute inset-0 z-0 h-full w-full" aria-hidden />
            {/* Layers: waveform, then the playhead line over it, then the marker lines on top. */}
            {inView(playheadX) && (
              <div
                data-marker="playhead"
                aria-hidden
                className="absolute inset-y-0 z-10 w-6 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${playheadX}%` }}
              >
                <span
                  className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
                  style={{ background: PLAYHEAD_COLOR }}
                />
              </div>
            )}
            {MARKERS.map((m) => {
              const x = xPct(draft[m]);
              if (!inView(x)) return null;
              return (
                <div
                  key={m}
                  data-marker={m}
                  aria-hidden
                  className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize"
                  style={{ left: `${x}%` }}
                >
                  <span
                    className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
                    style={{ background: MARKER_COLOR[m] }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Overview of the whole track: the box is the visible part, drag it to scroll. */}
        <div
          ref={overviewRef}
          className="relative h-8 touch-none overflow-hidden rounded-[8px] border border-line bg-deep select-none"
          onPointerDown={onOverviewPointerDown}
          onPointerMove={onOverviewPointerMove}
          onPointerUp={onOverviewPointerUp}
          onPointerCancel={onOverviewPointerUp}
          role="scrollbar"
          aria-label={t('loop.overview')}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round(Math.max(0, durationSec - viewLen))}
          aria-valuenow={Math.round(view.start)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              scrollTo(view.start + (e.key === 'ArrowRight' ? 0.25 : -0.25) * viewLen);
            }
          }}
        >
          <canvas ref={overviewCanvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
          <span
            className="absolute inset-y-0 w-[2px] -translate-x-1/2"
            style={{ left: `${(position / durationSec) * 100}%`, background: PLAYHEAD_COLOR }}
            aria-hidden
          />
          <div
            className="absolute inset-y-0 cursor-grab rounded-[6px] border border-line-strong bg-ink/10 active:cursor-grabbing"
            style={{
              left: `${(view.start / durationSec) * 100}%`,
              width: `${(viewLen / durationSec) * 100}%`,
            }}
            aria-hidden
          />
        </div>
      </div>

      {/* Transport and zoom. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <IconButton
            icon={playing ? Pause : Play}
            variant="secondary"
            label={t(playing ? 'loop.pauseTest' : paused ? 'loop.resumeTest' : 'loop.playTest')}
            onClick={playPause}
          />
          <IconButton
            icon={SkipBack}
            label={t('loop.playTrackTest')}
            onClick={() => startTest('track')}
          />
          <IconButton icon={Repeat} label={t('loop.playLoopTest')} onClick={() => startTest('loop')} />
          <IconButton icon={Square} label={t('loop.stopTest')} onClick={stopTest} disabled={!testing} />
        </div>
        <div className="flex min-w-40 flex-1 items-center gap-3">
          <span className="shrink-0 text-[13px] leading-5 text-ink-2">{t('loop.zoom')}</span>
          <input
            type="range"
            className="fader"
            min={0}
            max={Math.max(0, durationSec - MIN_VIEW_SEC)}
            step={0.5}
            value={durationSec - viewLen}
            aria-label={t('loop.zoom')}
            aria-valuetext={t('loop.zoomValue', { n: viewLen.toFixed(1) })}
            onChange={(e) => {
              const len = durationSec - Number(e.target.value);
              zoomTo(len, testing ? position : view.start + viewLen / 2);
            }}
            style={
              {
                '--v': durationSec > MIN_VIEW_SEC ? (durationSec - viewLen) / (durationSec - MIN_VIEW_SEC) : 0,
              } as CSSProperties
            }
          />
        </div>
      </div>

      {/* The four markers: tag, exact time, and "move it to the playhead". */}
      <div className="grid grid-cols-2 gap-2">
        {CHIP_ORDER.map((m) => (
          <div
            key={m}
            className="flex h-11 items-center rounded-[10px] border border-line bg-raised pl-2 focus-within:border-line-strong"
          >
            <span
              className="w-8 shrink-0 rounded-[4px] py-0.5 text-center font-mono text-[11px] leading-4 font-medium text-white"
              style={{ background: MARKER_COLOR[m] }}
              aria-hidden
            >
              {t(MARKER_TAG[m])}
            </span>
            <TimeInput
              value={draft[m]}
              label={t(MARKER_LABEL[m])}
              onCommit={(v) => setMarker(m, v)}
            />
            <IconButton
              icon={LocateFixed}
              label={t(SET_LABEL[m])}
              onClick={() => setMarker(m, position)}
              className="!size-10 shrink-0"
            />
          </div>
        ))}
      </div>

      {/* Gapless or crossfading loop. */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('loop.mode')}</span>
        <Segmented
          label={t('loop.mode')}
          value={draft.loopMode}
          onChange={(loopMode) => setDraft((d) => clamped({ ...d, loopMode }))}
          options={[
            { value: 'gapless', label: t('loop.mode.gapless') },
            { value: 'crossfade', label: t('loop.mode.crossfade') },
          ]}
        />
      </div>

      {showCrossfade && (
        <Field label={t('loop.crossfade')} hint={t('loop.crossfadeHint')}>
          {(id) => (
            <div className="flex items-center gap-3">
              <input
                id={id}
                type="range"
                className="fader"
                min={0}
                max={maxCrossfade}
                step={0.1}
                value={draft.crossfadeSec}
                aria-label={t('loop.crossfade')}
                aria-valuetext={t('loop.seconds', { n: draft.crossfadeSec.toFixed(1) })}
                onChange={(e) =>
                  setDraft((d) => clamped({ ...d, crossfadeSec: Number(e.target.value) }))
                }
                style={
                  { '--v': maxCrossfade > 0 ? draft.crossfadeSec / maxCrossfade : 0 } as CSSProperties
                }
              />
              <span className="w-14 shrink-0 text-right font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
                {draft.crossfadeSec.toFixed(1)}
              </span>
            </div>
          )}
        </Field>
      )}
    </Dialog>
  );
}

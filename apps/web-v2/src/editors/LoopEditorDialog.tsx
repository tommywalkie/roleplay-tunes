import type { LoopPreviewHandle } from '@dnd/audio-engine';

import {
  MAX_CROSSFADE_SEC,
  MIN_CROSSFADE_LOOP_SEC,
  resolveLoopSettings,
  type LoopSettings,
  type Sound,
} from '@dnd/shared';

import { Pause, Play, Square } from 'lucide-react';

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

import { Button, Field, Segmented, cx } from '../components/ui';

import { useI18n } from '../i18n';

import type { MessageKey } from '../i18n/en';

type Marker = 'trackStartSec' | 'loopStartSec' | 'loopEndSec' | 'trackEndSec';

const MARKERS: Marker[] = ['trackStartSec', 'loopStartSec', 'loopEndSec', 'trackEndSec'];

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

/** Smallest window the zoom slider allows, in seconds. */
const MIN_VIEW_SEC = 2;

/**
 * Fixed timeline colors, one per marker, as in the reference sketch:
 * track start blue with its tag at the bottom, loop start/end amber with tags on top,
 * track end purple with its tag at the bottom, playhead red.
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

/**
 * The loop editor: a zoomable waveform with four full-height draggable marker lines
 * (track start / loop start / loop end / track end, each with a labeled handle on top),
 * a draggable playhead, and a test sequence that can start from the track start or the
 * loop start and be paused, scrubbed and stopped. `onSave` hands the settings back to
 * the caller — the sound's defaults or one mix item's own — without touching the other.
 */
export function LoopEditorDialog({
  sound,
  initial,
  onSave,
  onClose,
}: {
  sound: Sound;
  /** The settings as they stand now (the sound's own, or a mix item's override). */
  initial: LoopSettings;
  onSave: (loop: LoopSettings) => void;
  onClose: () => void;
}) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const durationSec = sound.durationSec;
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
  const dragRef = useRef<Marker | 'playhead' | null>(null);

  const clamped = (d: LoopSettings) => resolveLoopSettings({ durationSec, ...d });
  const setMarker = (key: Marker, value: number) =>
    setDraft((d) => clamped({ ...d, [key]: value }));

  useEffect(() => {
    let alive = true;
    void player.waveformPeaks(sound.id, 480).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [player, sound.id]);

  // The test sequence never outlives the dialog.
  useEffect(() => () => handleRef.current?.stop(), []);

  // Live-update the running test when the markers move.
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
  const xPct = useCallback(
    (time: number) => ((time - view.start) / viewLen) * 100,
    [view.start, viewLen],
  );

  // Waveform drawing, only over the visible window.
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
      const n = peaks?.length ?? 0;
      if (n > 0 && peaks) {
        const mid = h / 2;
        // Bars get thinner as the whole track fits in the window, fatter when zoomed in.
        const barW = Math.max(1, Math.min(4, 1 + 3 * (1 - viewLen / durationSec)));
        const i0 = Math.max(0, Math.floor((view.start / durationSec) * n));
        const i1 = Math.min(n, Math.ceil((view.end / durationSec) * n));
        for (let i = i0; i < i1; i++) {
          const t = ((i + 0.5) / n) * durationSec;
          const x = (xPct(t) / 100) * w;
          const inTrack = t >= draft.trackStartSec && t <= draft.trackEndSec;
          const inLoop = t >= draft.loopStartSec && t <= draft.loopEndSec;
          const region = !inTrack
            ? REGION.outside
            : inLoop
              ? REGION.loop
              : t < draft.loopStartSec
                ? REGION.lead
                : REGION.tail;
          ctx.fillStyle = region.bar;
          ctx.globalAlpha = inTrack ? 1 : 0.35;
          const bh = Math.max(1, peaks[i] * (h - 4));
          ctx.fillRect(x - barW / 2, mid - bh / 2, barW, bh);
        }
        ctx.globalAlpha = 1;
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [peaks, draft, view, xPct, durationSec]);

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

  /** Zooms the window around `center` (seconds) to `len` seconds, clamped. */
  const zoomTo = useCallback(
    (len: number, center: number) => {
      const l = Math.min(durationSec, Math.max(MIN_VIEW_SEC, len));
      const start = Math.min(Math.max(center - l / 2, 0), durationSec - l);
      setView({ start, end: start + l });
    },
    [durationSec],
  );

  const onWavePointerDown = (e: ReactPointerEvent) => {
    const hit = (e.target as HTMLElement).closest('[data-marker]') as HTMLElement | null;
    const marker = hit?.dataset.marker as Marker | 'playhead' | undefined;
    if (marker && hit) {
      dragRef.current = marker;
      hit.setPointerCapture(e.pointerId);
      if (marker === 'playhead') {
        const at = timeAt(e.clientX);
        setPosition(at);
        handleRef.current?.seekTo(at);
      } else {
        setMarker(marker, timeAt(e.clientX));
      }
    } else if (testing) {
      // Dragging on the waveform itself scrubs the test sequence.
      dragRef.current = 'playhead';
      waveRef.current?.setPointerCapture(e.pointerId);
      const at = timeAt(e.clientX);
      setPosition(at);
      handleRef.current?.seekTo(at);
    } else {
      // Clicking the waveform positions the play marker.
      setPosition(timeAt(e.clientX));
    }
  };
  // A plain click on the waveform moves the playhead there while the test runs.
  const onWaveClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-marker]')) return;
    const at = timeAt(e.clientX);
    setPosition(at);
    if (testing) handleRef.current?.seekTo(at);
  };
  const onWavePointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const at = timeAt(e.clientX);
    if (dragRef.current === 'playhead') {
      setPosition(at);
      handleRef.current?.seekTo(at);
    } else {
      setMarker(dragRef.current, at);
    }
  };
  const onWavePointerUp = (e: ReactPointerEvent) => {
    const marker = dragRef.current;
    dragRef.current = null;
    if (!marker || marker === 'playhead') return;
    // Snap loop points to a zero crossing so the seam stays click-free.
    if (marker === 'loopStartSec' || marker === 'loopEndSec') {
      const at = timeAt(e.clientX);
      void player.snapToZero(sound.id, at).then((snapped) => setMarker(marker, snapped));
    }
  };

  // Mouse-wheel zoom around the cursor, non-passive so the page does not scroll.
  useEffect(() => {
    const el = waveRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const center = timeAtRef.current(e.clientX);
      zoomTo(viewLenRef.current * (e.deltaY > 0 ? 1.25 : 0.8), center);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const timeAtRef = useRef(timeAt);
  timeAtRef.current = timeAt;
  const viewLenRef = useRef(viewLen);
  viewLenRef.current = viewLen;

  // Play starts the test from wherever the play marker sits.
  const startTest = (from: 'marker' | 'track' | 'loop' = 'marker') => {
    handleRef.current?.stop();
    const handle = player.previewLoopTest(sound, draft);
    handleRef.current = handle;
    setTesting(true);
    setPaused(false);
    if (from === 'track') handle.playFromStart();
    else if (from === 'loop') handle.seekTo(draft.loopStartSec);
    else handle.seekTo(position);
  };
  const pauseTest = () => {
    const h = handleRef.current;
    if (!h) return;
    if (paused) {
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

  /** Sets a marker at the play marker's position. */
  const setAtCursor = (key: Marker) => {
    setMarker(key, position);
  };

  const loopLen = draft.loopEndSec - draft.loopStartSec;
  const maxCrossfade = Math.min(MAX_CROSSFADE_SEC, loopLen / 2);
  const showCrossfade = draft.loopMode === 'crossfade' && loopLen >= MIN_CROSSFADE_LOOP_SEC;

  const apply = () => {
    stopTest();
    onSave(clamped(draft));
    onClose();
  };

  return (
    <Dialog
      title={t('loop.title')}
      onClose={() => {
        stopTest();
        onClose();
      }}
      onSubmit={apply}
      footer={
        <>
          <Button onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('common.apply')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-5 text-ink-3">{t('loop.hint')}</p>

      {/* Waveform with the marker labels on rows above/below it, never clipped inside the box. */}
      <div
        className="relative touch-none select-none pt-6 pb-6"
        onPointerDown={onWavePointerDown}
        onPointerMove={onWavePointerMove}
        onPointerUp={onWavePointerUp}
        onClick={onWaveClick}
        role="group"
        aria-label={t('loop.waveform')}
      >
        {/* Label rows: LS/LF on top, TS/TF on the bottom, outside the waveform box. */}
        {MARKERS.map((m) => {
          const x = Math.min(100, Math.max(0, xPct(draft[m])));
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
                'absolute z-10 w-8 -translate-x-1/2 cursor-ew-resize rounded-[4px] px-1.5 py-0.5 text-center font-mono text-[10px] leading-3 font-semibold text-white',
                MARKER_TAG_SIDE[m] === 'top' ? 'top-0' : 'bottom-0',
              )}
              style={{ left: `${x}%`, background: MARKER_COLOR[m] }}
            >
              {t(MARKER_TAG[m])}
            </span>
          );
        })}
        <div
          ref={waveRef}
          className="relative h-28 rounded-[12px] border border-line bg-deep"
        >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full rounded-[12px]"
          aria-hidden
        />
        {/* Region washes: gray outside the track, blue before the loop, amber in the loop, purple after it.
            Each is clamped to the visible window so it never spills when zoomed inside another zone. */}
        {(
          [
            [0, draft.trackStartSec, REGION.outside.wash, 'rounded-l-[12px]'],
            [draft.trackStartSec, draft.loopStartSec, REGION.lead.wash, ''],
            [draft.loopStartSec, draft.loopEndSec, REGION.loop.wash, ''],
            [draft.loopEndSec, draft.trackEndSec, REGION.tail.wash, ''],
            [draft.trackEndSec, durationSec, REGION.outside.wash, 'rounded-r-[12px]'],
          ] as const
        ).map(([a, b, wash, rounded]) => {
          const left = Math.min(100, Math.max(0, xPct(a)));
          const right = Math.min(100, Math.max(0, xPct(b)));
          if (right <= left) return null;
          return (
            <div
              key={`${a}-${b}`}
              className={`absolute inset-y-0 ${rounded}`}
              style={{ left: `${left}%`, width: `${right - left}%`, background: wash }}
              aria-hidden
            />
          );
        })}
        {MARKERS.map((m) => {
          const x = Math.min(100, Math.max(0, xPct(draft[m])));
          return (
            <div
              key={m}
              data-marker={m}
              aria-hidden
              className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize"
              style={{ left: `${x}%` }}
            >
              {/* The full-height line itself is the drag target and is always drawn. */}
              <span
                className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
                style={{ background: MARKER_COLOR[m] }}
                aria-hidden
              />
            </div>
          );
        })}
        {/* The playhead: always visible, draggable, click on the waveform to move it. */}
        {
          <div
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
                const at = position + (e.key === 'ArrowRight' ? 0.1 : -0.1);
                setPosition(at);
                handleRef.current?.seekTo(at);
              }
            }}
            className="absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${Math.min(100, Math.max(0, xPct(position)))}%` }}
          >
            <span
              className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2"
              style={{ background: PLAYHEAD_COLOR }}
              aria-hidden
            />
            <span
              className="absolute top-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent"
              style={{ borderTopColor: PLAYHEAD_COLOR }}
              aria-hidden
            />
          </div>
        }
        </div>
      </div>

      {/* Zoom: a slider, and the mouse wheel over the waveform. */}
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-[13px] leading-5 text-ink-2">{t('loop.zoom')}</span>
        <input
          type="range"
          className="w-full accent-[#f0a23b]"
          min={0}
          max={Math.max(0, durationSec - MIN_VIEW_SEC)}
          step={0.5}
          value={durationSec - viewLen}
          aria-label={t('loop.zoom')}
          aria-valuetext={t('loop.zoomValue', { n: viewLen })}
          onChange={(e) => {
            const len = durationSec - Number(e.target.value);
            zoomTo(len, testing ? position : view.start + viewLen / 2);
          }}
        />
        <span className="w-16 shrink-0 text-right font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
          {Math.round(100 - (viewLen / durationSec) * 100)}%
        </span>
      </div>

      {/* The four marker values, editable and synced with the waveform markers. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {MARKERS.map((m) => (
          <label key={m} className="flex flex-col gap-1">
            <span className="text-[12px] leading-4 text-ink-3">{t(MARKER_LABEL[m])}</span>
            <input
              type="number"
              className="h-9 w-full rounded-[8px] border border-line bg-raised px-2 font-mono text-[13px] leading-5 text-ink tabular-nums focus:border-line-strong focus:outline-2 focus:outline-lamp"
              min={0}
              max={durationSec}
              step={0.1}
              value={Number(draft[m].toFixed(2))}
              aria-label={t(MARKER_LABEL[m])}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setMarker(m, v);
              }}
            />
          </label>
        ))}
      </div>

      {/* Transport: play from the play marker, pause/resume, stop. */}
      <div className="grid grid-cols-3 gap-2">
        <Button icon={Play} variant="primary" onClick={() => startTest('marker')}>
          {t('loop.playTest')}
        </Button>
        <Button icon={Play} onClick={() => startTest('track')}>
          {t('loop.playTrackTest')}
        </Button>
        <Button icon={Play} onClick={() => startTest('loop')}>
          {t('loop.playLoopTest')}
        </Button>
        <Button icon={paused ? Play : Pause} onClick={pauseTest} disabled={!testing}>
          {paused ? t('loop.resumeTest') : t('loop.pauseTest')}
        </Button>
        <Button icon={Square} onClick={stopTest} disabled={!testing}>
          {t('player.stopAll')}
        </Button>
        {MARKERS.map((m) => (
          <Button key={m} className="!h-10 text-[13px]" onClick={() => setAtCursor(m)}>
            {t(SET_LABEL[m])}
          </Button>
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
                {draft.crossfadeSec.toFixed(1)} s
              </span>
            </div>
          )}
        </Field>
      )}
    </Dialog>
  );
}

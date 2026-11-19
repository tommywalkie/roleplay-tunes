import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { cx } from './ui';

/** One speed for every text, whatever its length. */
const PX_PER_SECOND = 30;
/** The pauses, in seconds, so a short name waits as long as a long one. */
const LEAD_IN = 0.4;
const REST_AT_END = 1.2;
const FADE_OUT = 0.5;
const GONE = 0.6;
const FADE_IN = 0.5;
const READABLE = 1.2;
const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * Text too long for its box, carried across it instead of cut off: a short hold, a slide
 * from right to left at one fixed speed, a rest at the end, a fade out, a moment gone, then
 * back to the start to fade in again.
 *
 * The slide is the only phase whose length follows the text, so the run is built here rather
 * than in a stylesheet: fixed seconds and a variable slide cannot both live in one set of
 * percentage keyframes.
 *
 * Only text that actually overflows moves. Anything that fits is left exactly as it was, and
 * under `prefers-reduced-motion` overflowing text keeps its ellipsis and never animates, so
 * this is a way to read a name, not decoration.
 *
 * Pass the text as `children`: it is measured as one run of glyphs, and wrapping it in
 * elements would break both the measurement and the reading.
 */
export function Marquee({
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<'span'> & { children: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);
  const [run, setRun] = useState(false);

  useEffect(() => {
    const box = outer.current;
    const text = inner.current;
    if (!box || !text) return;

    const stop = () => {
      anim.current?.cancel();
      anim.current = null;
    };

    const measure = () => {
      // A pixel of slack: rounding a fractional width would otherwise start a marquee on
      // text that fits.
      const over = text.offsetWidth - box.clientWidth;
      const reduced =
        typeof window.matchMedia === 'function' && window.matchMedia(REDUCED).matches;
      stop();
      if (over <= 1 || reduced || typeof text.animate !== 'function') {
        setRun(false);
        return;
      }
      const slide = over / PX_PER_SECOND;
      const total = LEAD_IN + slide + REST_AT_END + FADE_OUT + GONE + FADE_IN + READABLE;
      const at = (seconds: number) => seconds / total;
      const shift = `translateX(${-over}px)`;
      const home = 'translateX(0)';
      // Offsets in seconds, converted to the fractions the timeline wants.
      const o1 = at(LEAD_IN);
      const o2 = at(LEAD_IN + slide);
      const o3 = at(LEAD_IN + slide + REST_AT_END);
      const o4 = at(LEAD_IN + slide + REST_AT_END + FADE_OUT);
      const o5 = at(LEAD_IN + slide + REST_AT_END + FADE_OUT + GONE);
      const o6 = at(LEAD_IN + slide + REST_AT_END + FADE_OUT + GONE + FADE_IN);
      anim.current = text.animate(
        [
          { offset: 0, transform: home, opacity: 1 },
          { offset: o1, transform: home, opacity: 1 },
          { offset: o2, transform: shift, opacity: 1 },
          { offset: o3, transform: shift, opacity: 1 },
          { offset: o4, transform: shift, opacity: 0 },
          { offset: o5, transform: shift, opacity: 0 },
          // Put back at the start while still invisible, then faded in there.
          { offset: o5 + 0.0001, transform: home, opacity: 0 },
          { offset: o6, transform: home, opacity: 1 },
          { offset: 1, transform: home, opacity: 1 },
        ],
        { duration: Math.round(total * 1000), iterations: Infinity, easing: 'linear' },
      );
      setRun(true);
    };

    // Both boxes matter: the text changes when the name does, the container when the layout
    // does (the player is a column on desktop and a dock on phones).
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(text);
    measure();
    return () => {
      observer.disconnect();
      stop();
    };
  }, [children]);

  return (
    <span ref={outer} data-run={run || undefined} className={cx('marquee', className)} {...rest}>
      <span ref={inner}>{children}</span>
    </span>
  );
}

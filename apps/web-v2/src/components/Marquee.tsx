import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
} from 'react';
import { cx } from './ui';

/** How long the whole cycle runs per 1000px it has to travel, and its floor and ceiling. */
const SECONDS_PER_1000PX = 22;
const MIN_SECONDS = 7;
const MAX_SECONDS = 34;
/** The share of the cycle spent sliding, matching the keyframes in `index.css`. */
const SLIDE_SHARE = 0.4;

/**
 * Text too long for its box, carried across it instead of cut off: it holds, slides from
 * right to left, rests at the end, fades out, and fades back where it started.
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
  const [run, setRun] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const box = outer.current;
    const text = inner.current;
    if (!box || !text) return;

    const measure = () => {
      // A pixel of slack: rounding a fractional width would otherwise start a marquee on
      // text that fits.
      const over = text.offsetWidth - box.clientWidth;
      if (over <= 1) {
        setRun(false);
        setStyle({});
        return;
      }
      // The time to read the whole of it, not a fixed speed: a two-word name should not
      // crawl, a long one should not blur past.
      const slide = Math.min(
        MAX_SECONDS,
        Math.max(MIN_SECONDS, (over / 1000) * SECONDS_PER_1000PX),
      );
      setRun(true);
      // The same cast the fader uses to hand a custom property to `style`.
      setStyle({
        '--marquee-shift': `${-over}px`,
        '--marquee-cycle': `${(slide / SLIDE_SHARE).toFixed(2)}s`,
      } as CSSProperties);
    };

    // Both boxes matter: the text changes when the name does, the container when the layout
    // does (the player is a column on desktop and a dock on phones).
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(text);
    measure();
    return () => observer.disconnect();
  }, [children]);

  return (
    <span
      ref={outer}
      data-run={run || undefined}
      style={style}
      className={cx('marquee', className)}
      {...rest}
    >
      <span ref={inner}>{children}</span>
    </span>
  );
}

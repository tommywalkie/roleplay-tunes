import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './ui';

const GAP = 12;
const EDGE = 8;
const FINE_POINTER = '(pointer: fine)';

/**
 * A short note beside what it describes, for the things a row cannot spell out: a license,
 * a limit, a figure that needs a sentence to mean anything.
 *
 * The note opens on hover and on keyboard focus where the pointer is precise, and on tap
 * everywhere else — a note that only answers to a hover cannot be read on a phone, which is
 * most of what this app runs on. The trigger is a real button holding `label` as its
 * accessible name, so the note itself is hidden from screen readers: it repeats what the
 * name already says, and reading it twice helps nobody.
 */
export function Popover({
  label,
  note,
  children,
  className,
  /**
   * The children already are the trigger — a button with its own action. The note then
   * hangs on hover and keyboard focus around it, and the wrapper adds no button of its own.
   */
  wrap = false,
}: {
  /** What the trigger says to a screen reader: the whole of what the note shows. */
  label: string;
  /** What the note says. */
  note: ReactNode;
  /** What the trigger shows. */
  children: ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  const noteId = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  // jsdom has no matchMedia, and a missing one means no fine pointer to rely on.
  const [hoverable] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(FINE_POINTER).matches,
  );

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const height = box.current?.offsetHeight ?? 0;
      const width = box.current?.offsetWidth ?? 0;
      const below = rect.bottom + GAP;
      const top =
        below + height > window.innerHeight - EDGE ? Math.max(EDGE, rect.top - GAP - height) : below;
      const left = Math.min(
        Math.max(EDGE, rect.left + rect.width / 2 - width / 2),
        Math.max(EDGE, window.innerWidth - width - EDGE),
      );
      setPlace({ top, left });
    };
    // Measured once the note is in the document, so its own size decides where it sits.
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      anchor.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      setOpen(false);
    };
    // The page under a note may scroll; the note would then float away from its trigger.
    const onScroll = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  // A tap raises focus before it fires the click, so opening on any focus would have the
  // click close again what the tap just opened. Only keyboard focus opens it here; a tap
  // is handled by the click below, on every kind of pointer.
  const onFocus = () => {
    if (anchor.current?.matches(':focus-visible')) show();
  };

  const portal = open &&
    createPortal(
      <div
        ref={box}
        id={noteId}
        role="tooltip"
        aria-hidden
        onMouseEnter={hoverable ? show : undefined}
        onMouseLeave={hoverable ? hide : undefined}
        style={{ top: place?.top ?? -9999, left: place?.left ?? -9999 }}
        className="fixed z-50 max-w-[240px] animate-fade rounded-[10px] border border-line-strong bg-card px-2.5 py-1.5 text-[13px] leading-5 text-ink-2 shadow-[0_12px_32px_rgb(0_0_0/0.45)]"
      >
        {note}
      </div>,
      document.body,
    );

  if (wrap) {
    return (
      <span
        ref={(el) => {
          anchor.current = el;
        }}
        className={cx('relative inline-flex shrink-0', className)}
        onMouseEnter={hoverable ? show : undefined}
        onMouseLeave={hoverable ? hide : undefined}
        onFocusCapture={(e) => {
          if ((e.target as HTMLElement).matches?.(':focus-visible')) show();
        }}
        onBlurCapture={hide}
      >
        {children}
        {portal}
      </span>
    );
  }

  return (
    <span className={cx('relative inline-flex shrink-0', className)}>
      <button
        ref={(el) => {
          anchor.current = el;
        }}
        type="button"
        aria-label={label}
        onClick={() => {
          // A precise pointer already opened the note on the way in: a click there would
          // only close it under the cursor.
          if (!hoverable) setOpen((v) => !v);
        }}
        onMouseEnter={hoverable ? show : undefined}
        onMouseLeave={hoverable ? hide : undefined}
        onFocus={onFocus}
        onBlur={hide}
        className="flex shrink-0 items-center justify-center rounded-[6px] text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink focus-visible:text-ink"
      >
        {children}
      </button>
      {portal}
    </span>
  );
}

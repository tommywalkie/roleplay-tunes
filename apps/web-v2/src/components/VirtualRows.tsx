import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Items mounted before the first measurement lands, so there is a row to measure. */
const INITIAL_ITEMS = 24;
/** Rows kept above and below the visible band, so a fast flick never shows a hole. */
const OVERSCAN = 3;

/**
 * A list whose rows all share one height, with only the rows the reader can reach
 * mounted. The scrolling and windowing are TanStack Virtual's; this component adds what
 * our lists need around it:
 *
 * - **Grids.** With `minCell`, the list is a grid of as many columns as fit its width,
 *   and a virtual row is one line of cells.
 * - **Plain markup.** The `<ul>` holds its `<li>` items directly, so list semantics and
 *   CSS grid keep working. Rows that are not mounted are stood in for by padding on the
 *   list, above and below.
 * - **Two kinds of scroller.** With `scrollClassName`, a box around the list scrolls it
 *   (the users card). Without, the list scrolls with the app's `<main>`, and its offset
 *   inside it (`scrollMargin`) is kept up to date as what sits above it changes.
 *
 * The padded list must never be the scroller itself: a box cannot be shorter than its own
 * padding, so it would grow past its height, stop scrolling, and show blank padding.
 *
 * Every row has the height of the first mounted one, measured from the DOM. Where there is
 * nothing to measure or no scroller — jsdom lays nothing out, and a list outside `<main>`
 * has nothing to follow — the whole list is mounted, like a plain one.
 *
 * `renderItem` returns elements that carry their own `key`: the window moves as the reader
 * scrolls, and a stable key is what keeps a row from being remounted under it.
 */
export function VirtualRows({
  className,
  scrollClassName,
  label,
  count,
  renderItem,
  minCell,
  gap = 0,
}: {
  /** Classes of the list itself. Never give it a height or `overflow`: see above. */
  className?: string;
  /** Classes of a box around the list that scrolls it, with its height or max height. */
  scrollClassName?: string;
  /** Names the list for a screen reader, as a plain `ul` would. */
  label: string;
  /** How many items there are in all. */
  count: number;
  /** The item at `index`, as it would sit in an unvirtualised list. */
  renderItem: (index: number) => ReactNode;
  /** Narrowest cell, which makes the list a grid of as many columns as fit. */
  minCell?: number;
  /** Pixels between rows, and between the cells of one row. */
  gap?: number;
}) {
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  // null until a row could be measured; 0 when rows have no height (no layout).
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const [margin, setMargin] = useState(0);

  const columns =
    minCell && width > 0 ? Math.max(1, Math.floor((width + gap) / (minCell + gap))) : 1;
  const rows = Math.ceil(count / columns);
  const active = scroller !== null && rowHeight !== null && rowHeight > 0;

  /** Width, row height and offset in the scroller, read in one go from the DOM. */
  const measure = useCallback(() => {
    const el = list.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const cell = el.firstElementChild as HTMLElement | null;
    // An empty list keeps the last height: the next items will have the same.
    if (cell) setRowHeight(cell.offsetHeight);
    const scrolling = box.current ?? (el.closest('main') as HTMLElement | null);
    if (scrolling) {
      // Where the list starts inside what scrolls, whatever the current scroll.
      const offset =
        el.getBoundingClientRect().top - scrolling.getBoundingClientRect().top + scrolling.scrollTop;
      // Sub-pixel noise from scrolling would otherwise re-render on every frame.
      setMargin((m) => (Math.abs(m - offset) < 1 ? m : offset));
    }
  }, []);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    setScroller(box.current ?? (el.closest('main') as HTMLElement | null));
  }, []);

  // After every render: what was rendered may have moved or resized the list.
  useLayoutEffect(measure);

  // And whenever layout changes without this list rendering: the window, the list's own
  // size, or anything above it in the scroller (a filter row appearing, text wrapping).
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    const content = box.current ?? el.closest('main')?.firstElementChild;
    if (content) observer.observe(content);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [measure]);

  const virtualizer = useVirtualizer({
    count: rows,
    enabled: active,
    getScrollElement: () => scroller,
    // It only reads the position on the next scroll event: a list that starts while its
    // scroller is already scrolled (back to a long page) must start from there.
    initialOffset: () => scroller?.scrollTop ?? 0,
    estimateSize: () => rowHeight || 1,
    gap,
    overscan: OVERSCAN,
    scrollMargin: margin,
    useFlushSync: false,
  });

  // Row sizes are estimates, not per-row measurements: drop them when the height changes.
  useLayoutEffect(() => {
    if (active) virtualizer.measure();
  }, [active, rowHeight, gap, columns, virtualizer]);

  let firstItem = 0;
  let endItem = count;
  let paddingTop = 0;
  let paddingBottom = 0;
  if (rowHeight === null) {
    // Nothing measured yet: a first slice to measure, not the whole list at once.
    endItem = Math.min(count, INITIAL_ITEMS);
  } else if (active) {
    const virtualRows = virtualizer.getVirtualItems();
    const top = virtualRows[0];
    const bottom = virtualRows[virtualRows.length - 1];
    if (top && bottom) {
      firstItem = top.index * columns;
      endItem = Math.min(count, (bottom.index + 1) * columns);
      // Starts and ends count from the top of the scroller's content; the list starts
      // `margin` below it.
      paddingTop = top.start - margin;
      paddingBottom = Math.max(0, virtualizer.getTotalSize() - (bottom.end - margin));
    } else {
      endItem = 0;
    }
  }

  const slice: ReactNode[] = [];
  for (let i = firstItem; i < endItem; i++) slice.push(renderItem(i));

  const ul = (
    <ul
      ref={list}
      aria-label={label}
      className={className}
      style={{
        gap,
        paddingTop,
        paddingBottom,
        ...(columns > 1 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {}),
      }}
    >
      {slice}
    </ul>
  );
  if (!scrollClassName) return ul;
  return (
    <div ref={box} className={scrollClassName}>
      {ul}
    </div>
  );
}

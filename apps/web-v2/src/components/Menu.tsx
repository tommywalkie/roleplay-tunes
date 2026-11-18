import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx, Icon } from './ui';

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  /** A second, quieter line under the label. */
  hint?: string;
  onSelect: () => void;
}

const WIDE = '(min-width: 768px)';
const MENU_WIDTH = 264;
const GAP = 4;

/**
 * A list of actions opened from a button. From tablet width up it drops down from that
 * button; on phones it is a centered panel over a dimmed page, out of the thumb's way.
 */
export function Menu({
  title,
  items,
  anchor,
  onClose,
}: {
  /** Names what the actions apply to; shown as the panel's heading on phones. */
  title: string;
  items: MenuItem[];
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const titleId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [wide] = useState(() => window.matchMedia(WIDE).matches);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!wide) return;
    const measure = () => {
      const box = anchor.getBoundingClientRect();
      const height = list.current?.offsetHeight ?? 0;
      const left = Math.min(Math.max(8, box.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
      const below = box.bottom + GAP;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - GAP - height) : below;
      setPlace({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor, wide]);

  useEffect(() => {
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    };
    // The page under a drop-down may scroll; the menu would then float away from its button.
    const onScroll = (e: Event) => {
      if (wide && !list.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose, wide]);

  const choose = (item: MenuItem) => {
    onClose();
    item.onSelect();
  };

  const entries = items.map((item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      onClick={() => choose(item)}
      className="flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 py-2 text-left text-[14px] leading-5 text-ink outline-none transition-colors duration-150 hover:bg-raised focus-visible:bg-raised"
    >
      <Icon icon={item.icon} className="text-ink-2" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{item.label}</span>
        {item.hint && <span className="truncate text-[12px] leading-4 text-ink-3">{item.hint}</span>}
      </span>
    </button>
  ));

  return createPortal(
    <div className={cx('fixed inset-0 z-50', !wide && 'flex items-center justify-center p-6')}>
      <div
        className={cx('absolute inset-0', !wide && 'animate-fade bg-black/60')}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={list}
        role="menu"
        aria-labelledby={wide ? undefined : titleId}
        aria-label={wide ? title : undefined}
        style={wide ? { top: place?.top ?? -9999, left: place?.left ?? -9999, width: MENU_WIDTH } : undefined}
        className={cx(
          'flex flex-col gap-0.5 border border-line-strong bg-card p-1.5',
          wide
            ? 'absolute animate-fade rounded-[14px] shadow-[0_12px_32px_rgb(0_0_0/0.45)]'
            : 'relative w-full max-w-[360px] animate-sheet rounded-[20px] p-2',
        )}
      >
        {!wide && (
          <h2 id={titleId} className="truncate px-3 pb-2 pt-2 text-[15px] leading-6 font-medium">
            {title}
          </h2>
        )}
        {entries}
      </div>
    </div>,
    document.body,
  );
}

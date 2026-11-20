import type { Illustration as IllustrationData } from '@dnd/shared';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { useCallback, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { AddedBadge } from './AddedBadge';
import { Illustration } from './Illustration';
import { Menu, type MenuItem } from './Menu';
import { cx, Icon, Lamp } from './ui';

export interface TileProgress {
  /** Changes for every new run, so the bar restarts. */
  id: string;
  startedAt: number;
  durationSec: number;
}

interface TileProps {
  name: string;
  illustration: IllustrationData;
  fallback: LucideIcon;
  /** One quiet line under the name: mode, duration, counts. */
  meta: ReactNode;
  /** Lit while this item makes sound. */
  active?: boolean;
  /** A one-shot in flight: a bar fills over its duration. */
  progress?: TileProgress;
  /** How many other users have it in their library; shown on the meta line above one. */
  addedCount?: number;
  /** Tap action. Give `to` instead for a tile that opens a page. */
  onPress?: () => void;
  to?: string;
  onEdit?: () => void;
  editLabel?: string;
  /** When set, the corner button opens these actions instead of calling onEdit. */
  menu?: MenuItem[];
}

const SURFACE =
  'group/tile relative block w-full overflow-hidden rounded-[14px] border bg-card text-left ' +
  'transition-[background-color,border-color,transform] duration-150 ease-out ' +
  'has-[.tile-tap:hover]:bg-raised has-[.tile-tap:active]:scale-[0.98]';

/**
 * One item of the board. The whole tile is the tap target; the edit button sits beside
 * it in the corner (never inside it), always visible, so touch needs no hover.
 */
export function Tile({
  name,
  illustration,
  fallback,
  meta,
  addedCount,
  active = false,
  onPress,
  to,
  onEdit,
  editLabel,
  menu,
}: TileProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  const hasImage = illustration.type === 'image';
  const tap = (
    <>
      {/* A 70px band on phones, so more tiles fit; 4:3 from tablet width. */}
      <span className="relative block h-[70px] overflow-hidden bg-deep/40 md:h-auto md:aspect-[4/3]">
        <Illustration value={illustration} fallback={fallback} lit={active} tile />
        {hasImage && active && <span className="absolute inset-0 bg-lamp/10" aria-hidden />}
      </span>
      <span className="flex items-center gap-2 px-3 pt-2.5 pb-0.5">
        <Lamp on={active} />
        <span className="truncate text-[14px] leading-5 font-medium text-ink">{name}</span>
      </span>
    </>
  );
  const surface = cx(SURFACE, active ? 'border-lamp/70' : 'border-line');

  return (
    <li className="relative">
      <div className={surface}>
        {to ? (
          <Link to={to} className="tile-tap block w-full">
            {tap}
          </Link>
        ) : (
          <button
            type="button"
            aria-pressed={active}
            onClick={onPress}
            className="tile-tap block w-full text-left"
          >
            {tap}
          </button>
        )}
        <div className="flex items-center gap-1.5 px-3 pb-3 text-[12px] leading-4 text-ink-3 tabular-nums">
          {meta}
          {/* The owner is never in this count, so any number at all means someone else. */}
          {addedCount !== undefined && addedCount > 0 && <AddedBadge count={addedCount} />}
        </div>
      </div>
      {(onEdit || menu) && (
        <button
          type="button"
          onClick={(e) => (menu ? setMenuAnchor(e.currentTarget) : onEdit?.())}
          aria-haspopup={menu ? 'menu' : undefined}
          aria-expanded={menu ? menuAnchor !== null : undefined}
          aria-label={editLabel}
          title={editLabel}
          className="absolute right-1 top-1 flex size-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          <span className="flex size-8 items-center justify-center rounded-[8px] bg-deep/80">
            <Icon icon={Ellipsis} />
          </span>
        </button>
      )}
      {menu && menuAnchor && (
        <Menu title={name} items={menu} anchor={menuAnchor} onClose={closeMenu} />
      )}
    </li>
  );
}

/** The mosaic: tiles as wide as fits, never narrower than a thumb can hit. */
export function TileGrid({
  children,
  label,
  ref,
}: {
  children: ReactNode;
  label: string;
  /** The grid itself, for whoever needs its column count (`useGridColumns`). */
  ref?: Ref<HTMLUListElement>;
}) {
  return (
    <ul
      ref={ref}
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(164px,1fr))]"
    >
      {children}
    </ul>
  );
}

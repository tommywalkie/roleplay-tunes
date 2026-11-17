import type { Illustration as IllustrationData } from '@dnd/shared';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Illustration } from './Illustration';
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
  /** Tap action. Give `to` instead for a tile that opens a page. */
  onPress?: () => void;
  to?: string;
  onEdit?: () => void;
  editLabel?: string;
}

const SURFACE =
  'group/tile relative block w-full overflow-hidden rounded-[14px] border bg-card text-left ' +
  'transition-[background-color,border-color,transform] duration-150 ease-out ' +
  'hover:bg-raised active:scale-[0.98]';

/**
 * One item of the board. The whole tile is the tap target; the edit button sits beside
 * it in the corner (never inside it), always visible, so touch needs no hover.
 */
export function Tile({
  name,
  illustration,
  fallback,
  meta,
  active = false,
  progress,
  onPress,
  to,
  onEdit,
  editLabel,
}: TileProps) {
  const hasImage = illustration.type === 'image';
  const body = (
    <>
      <span className="relative block aspect-[4/3] bg-deep/40">
        <Illustration value={illustration} fallback={fallback} lit={active} />
        {hasImage && active && <span className="absolute inset-0 bg-lamp/10" aria-hidden />}
      </span>
      <span className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
        <span className="flex items-center gap-2">
          <Lamp on={active} />
          <span className="truncate text-[14px] leading-5 font-medium text-ink">{name}</span>
        </span>
        <span className="flex h-4 items-center gap-1.5 truncate pl-4 text-[12px] leading-4 text-ink-3 tabular-nums">
          {meta}
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 block h-0.5" aria-hidden>
        {progress && (
          <span
            key={progress.id}
            className="block size-full origin-left bg-lamp"
            style={{
              animation: `fill ${progress.durationSec}s linear both`,
              animationDelay: `${Math.min(0, (progress.startedAt - Date.now()) / 1000)}s`,
            }}
          />
        )}
      </span>
    </>
  );
  const surface = cx(SURFACE, active ? 'border-lamp/70' : 'border-line');

  return (
    <li className="relative">
      {to ? (
        <Link to={to} className={surface}>
          {body}
        </Link>
      ) : (
        <button type="button" aria-pressed={active} onClick={onPress} className={surface}>
          {body}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          title={editLabel}
          className="absolute right-1 top-1 flex size-10 items-center justify-center rounded-[10px] text-ink-2 transition-colors duration-150 hover:text-ink"
        >
          <span className="flex size-8 items-center justify-center rounded-[8px] bg-deep/80">
            <Icon icon={Ellipsis} />
          </span>
        </button>
      )}
    </li>
  );
}

/** The mosaic: tiles as wide as fits, never narrower than a thumb can hit. */
export function TileGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(164px,1fr))]"
    >
      {children}
    </ul>
  );
}

import type { Illustration as IllustrationData } from '@dnd/shared';
import type { LucideIcon } from 'lucide-react';
import { cx } from './ui';

/** What an editor holds before saving: a saved illustration, or a freshly picked image file. */
export type IllustrationDraft = IllustrationData | { type: 'file'; file: File; url: string };

/**
 * The picture of a sound, mix or scene, filling its parent box: an uploaded image
 * edge to edge, or the chosen icon centered. `fallback` shows when nothing was chosen.
 */
export function Illustration({
  value,
  fallback: Fallback,
  lit,
  iconClassName = 'size-12',
  tile = false,
}: {
  value: IllustrationDraft;
  fallback: LucideIcon;
  /** Icons take the lamp color while their item plays. */
  lit?: boolean;
  /** Size of the icon inside the box. */
  iconClassName?: string;
  /**
   * In a board tile. On phones the tile's picture is a short band: an image shows whole
   * over a blurred, darker copy of itself that fills the band, and an icon gets 4px of air.
   */
  tile?: boolean;
}) {
  if (value.type === 'image' || value.type === 'file') {
    const image = (className: string) => (
      <img
        src={value.url}
        alt=""
        loading="lazy"
        draggable={false}
        aria-hidden={className.includes('blur') || undefined}
        className={cx('absolute inset-0 size-full', className)}
      />
    );
    if (!tile) return image('object-cover');
    return (
      <>
        {image('scale-110 object-cover blur-md brightness-50 md:hidden')}
        {image('object-contain md:object-cover')}
      </>
    );
  }
  const tone = cx(
    'transition-colors duration-150',
    lit ? 'text-lamp' : value.type === 'icon' ? 'text-ink-2' : 'text-ink-3',
  );
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {value.type === 'icon' ? (
        // Markup comes from the server's own copy of the icon sets, never from a user.
        <span
          aria-hidden
          className={cx('svg-fill block', iconClassName, tile && 'p-1 md:p-0', tone)}
          dangerouslySetInnerHTML={{ __html: value.svg }}
        />
      ) : (
        <Fallback aria-hidden strokeWidth={1.25} className={cx(iconClassName, tone)} />
      )}
    </div>
  );
}

/**
 * A small square thumbnail for list rows. The box and the icon inside it are sized by the
 * caller rather than by a default in the class list: two `size-*` utilities on one element
 * resolve by stylesheet order, not by intent, which is how a 20px stack once grew to 40px
 * and painted over the name above it.
 */
export function Thumb({
  value,
  fallback,
  lit,
  size = 'size-10',
  radius = 'rounded-[8px]',
  iconSize = 'size-5',
  className,
}: {
  value: IllustrationDraft;
  fallback: LucideIcon;
  lit?: boolean;
  /** The box, e.g. `size-10`. */
  size?: string;
  /** Its corners, e.g. `rounded-[8px]`. */
  radius?: string;
  /** The icon inside it, kept smaller than the box. */
  iconSize?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'relative block shrink-0 overflow-hidden border border-line bg-raised',
        size,
        radius,
        className,
      )}
    >
      <Illustration value={value} fallback={fallback} lit={lit} iconClassName={iconSize} />
    </span>
  );
}

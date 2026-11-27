import { Bookmark } from 'lucide-react';
import { useI18n } from '../i18n';
import { Popover } from './Popover';
import { cx } from './ui';

/**
 * How many users have this in their library: "Added by N game masters", with that note behind
 * it. At 0 it is greyed out and carries no note.
 */
export function AddedBadge({ count }: { count: number }) {
  const { t, tn } = useI18n();
  const words = t('added.by', { count: tn('count.gameMasters', count) });
  const badge = (
    <span
      aria-label={count === 0 ? words : undefined}
      className={cx('flex min-w-0 items-center gap-1', count === 0 && 'text-ink-3')}
    >
      <Bookmark size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
      <span className="tabular-nums">{count}</span>
    </span>
  );
  if (count === 0) return badge;
  return (
    <Popover label={words} note={words}>
      {badge}
    </Popover>
  );
}

import { Bookmark } from 'lucide-react';
import { useI18n } from '../i18n';
import { Popover } from './Popover';

/**
 * How many users have this in their library, the way a bookmark count reads everywhere
 * else: the icon and the number, with the words on a note behind them.
 *
 * `used` is the reading a library row wants — "Used by 3 game masters", the account that
 * shared it counted out. A tile instead says what its own owner did: "Added by 3 other game
 * masters".
 */
export function AddedBadge({ count, used = false }: { count: number; used?: boolean }) {
  const { t, tn } = useI18n();
  const words = t(used ? 'used.by' : 'added.by', {
    count: tn(used ? 'count.gameMasters' : 'count.otherGameMasters', count),
  });
  return (
    <Popover label={words} note={words}>
      <span className="flex min-w-0 items-center gap-1">
        <Bookmark size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
        <span className="tabular-nums">{count}</span>
      </span>
    </Popover>
  );
}

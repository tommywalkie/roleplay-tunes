import { Popover } from './Popover';
import { useI18n } from '../i18n';
import { cx } from './ui';

/** Up to two letters for the avatar: the first letters of the first two words of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/**
 * Who shared an item: their initials, and their name beside them when there is room.
 *
 * The name shows on phones and tablets, where the row has a band of its own for it, and
 * again from 1440px up. Between those — a desktop window that is not wide — only the
 * initials show, and the name is in a `Popover` on the badge, so it is never lost.
 */
export function OwnerBadge({ owner }: { owner: string }) {
  const { t } = useI18n();

  return (
    <Popover label={t('library.by', { name: owner })} note={owner} className="min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised text-[10px] leading-none font-medium text-ink-2"
        >
          {initials(owner)}
        </span>
        <span
          aria-hidden
          className={cx('max-w-[10rem] truncate text-[13px] leading-5', 'lg:max-wide:hidden')}
        >
          {owner}
        </span>
      </span>
    </Popover>
  );
}

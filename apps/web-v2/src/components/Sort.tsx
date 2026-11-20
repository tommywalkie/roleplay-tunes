import { ArrowDownUp, ArrowDownZA, ArrowUpAZ, CalendarClock, Check, Clock } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Menu } from './Menu';
import { IconButton } from './ui';

/** How a list can be ordered: by name either way, or by when the item was added. */
export const SORTS = ['name-asc', 'name-desc', 'newest', 'oldest'] as const;
export type Sort = (typeof SORTS)[number];

/** Each way, with the icon and the words its menu entry uses. */
export const SORT_ITEMS: { value: Sort; label: MessageKey; icon: typeof Clock }[] = [
  { value: 'name-asc', label: 'sort.nameAsc', icon: ArrowUpAZ },
  { value: 'name-desc', label: 'sort.nameDesc', icon: ArrowDownZA },
  { value: 'newest', label: 'sort.newest', icon: CalendarClock },
  { value: 'oldest', label: 'sort.oldest', icon: Clock },
];

/** The list in the wanted order: any list of named, dated items, sounds and mixes alike. */
export function sorted<T extends { name: string; createdAt: string }>(items: T[], sort: Sort): T[] {
  const ordered = [...items];
  switch (sort) {
    case 'name-asc':
      return ordered.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return ordered.sort((a, b) => b.name.localeCompare(a.name));
    case 'newest':
      return ordered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'oldest':
      return ordered.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

/** Which way the list runs. A tick marks the current one, so it is never in doubt. */
export function SortControl({ value, onChange }: { value: Sort; onChange: (sort: Sort) => void }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        icon={ArrowDownUp}
        label={t('sort.label')}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(e.currentTarget)}
        variant="secondary"
      />
      {anchor && (
        <Menu
          title={t('sort.label')}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          items={SORT_ITEMS.map(({ value: option, label, icon }) => ({
            label: t(label),
            icon: option === value ? Check : icon,
            onSelect: () => onChange(option),
          }))}
        />
      )}
    </>
  );
}

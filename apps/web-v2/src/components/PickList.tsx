import type { Illustration } from '@dnd/shared';
import { Check, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { Thumb } from './Illustration';
import { matches, searchText } from './Page';
import { cx, Icon, SearchField } from './ui';

export interface PickItem {
  id: string;
  name: string;
  illustration: Illustration;
  /** Search also matches these. */
  synonyms?: { label: string }[];
}

/** A checklist of library items with its own search, for choosing several at once. */
export function PickList({
  label,
  items,
  selected,
  onChange,
  fallback,
  emptyText,
  max,
}: {
  label: string;
  items: PickItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  fallback: LucideIcon;
  emptyText: string;
  /** Unselected rows are disabled once this many are selected. */
  max?: number;
}) {
  const { t, tn } = useI18n();
  const [query, setQuery] = useState('');
  const chosen = new Set(selected);
  const shown = query.trim() ? items.filter((i) => matches(searchText(i), query)) : items;
  const full = max !== undefined && selected.length >= max;

  const toggle = (id: string) =>
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="flex w-full items-baseline justify-between pb-2 text-[13px] leading-5 text-ink-2">
        {label}
        <span className="text-[12px] text-ink-3 tabular-nums">
          {tn('common.selected', selected.length)}
        </span>
      </legend>
      {items.length === 0 ? (
        <p className="text-[14px] leading-5 text-ink-3">{emptyText}</p>
      ) : (
        <>
          {items.length > 6 && (
            <SearchField value={query} onChange={setQuery} label={t('common.search')} />
          )}
          <ul className="scroll-quiet flex max-h-64 flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-line bg-deep p-1">
            {shown.length === 0 && (
              <li className="px-3 py-3 text-[14px] leading-5 text-ink-3">
                {t('common.noMatch', { query: query.trim() })}
              </li>
            )}
            {shown.map((item) => {
              const on = chosen.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!on && full}
                    onClick={() => toggle(item.id)}
                    className={cx(
                      'flex h-12 w-full items-center gap-3 rounded-[8px] px-2 text-left transition-colors duration-150',
                      'hover:bg-raised disabled:opacity-45 disabled:hover:bg-transparent',
                      on && 'bg-raised',
                    )}
                  >
                    <Thumb value={item.illustration} fallback={fallback} size="size-8" />
                    <span className="min-w-0 flex-1 truncate text-[14px] leading-5">{item.name}</span>
                    <span
                      aria-hidden
                      className={cx(
                        'flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-150',
                        on ? 'border-ink bg-ink text-deep' : 'border-line-strong',
                      )}
                    >
                      {on && <Icon icon={Check} className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </fieldset>
  );
}

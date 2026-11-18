import { SYNONYM_MAX, SYNONYMS_PER_ITEM } from '@dnd/shared';
import { X } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useSynonyms } from '../api/hooks';
import { useI18n } from '../i18n';
import { matches } from './Page';
import { cx, TextInput } from './ui';

const SUGGESTIONS_SHOWN = 6;

/**
 * Other words to find an item by, as tags. The user adds and removes their own; the
 * owner's, on an item someone else shared, show without a remove button. Typing suggests
 * synonyms the user already put on other items. Enter adds, Backspace in an empty field
 * removes the user's last one. The same text twice (exactly) is added once.
 */
export function SynonymsField({
  mine,
  others = [],
  othersBy,
  onChange,
  error,
}: {
  mine: string[];
  /** Synonyms the item's owner set, shown but not removable here. */
  others?: string[];
  /** The owner's name, to say who set `others`. */
  othersBy?: string;
  onChange: (mine: string[]) => void;
  error?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const listId = useId();
  const known = useSynonyms().data;
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const present = useMemo(() => new Set([...mine, ...others]), [mine, others]);
  const full = mine.length >= SYNONYMS_PER_ITEM;
  const query = text.trim();
  const suggestions = useMemo(
    () =>
      (known ?? [])
        .filter((label) => !present.has(label) && (query === '' || matches(label, query)))
        .slice(0, SUGGESTIONS_SHOWN),
    [known, present, query],
  );
  const showList = open && !full && suggestions.length > 0;

  const add = (label: string) => {
    const clean = label.trim().slice(0, SYNONYM_MAX);
    setText('');
    setActive(0);
    if (clean === '' || present.has(clean) || full) return;
    onChange([...mine, clean]);
  };
  const remove = (label: string) => onChange(mine.filter((l) => l !== label));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Never submits the editor: Enter here means "add this word".
      e.preventDefault();
      if (showList && active > 0) add(suggestions[active - 1]!);
      else if (query) add(query);
      return;
    }
    if (e.key === 'ArrowDown' && showList) {
      e.preventDefault();
      setActive((a) => Math.min(suggestions.length, a + 1));
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Backspace' && text === '' && mine.length > 0) {
      remove(mine[mine.length - 1]!);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-5 text-ink-2">
        {t('synonyms.label')}
      </label>
      {(others.length > 0 || mine.length > 0) && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('synonyms.label')}>
          {others.map((label) => (
            <li
              key={`o:${label}`}
              title={othersBy ? t('synonyms.by', { name: othersBy }) : undefined}
              className="flex h-8 items-center rounded-full border border-line px-3 text-[13px] leading-5 text-ink-3"
            >
              {label}
            </li>
          ))}
          {mine.map((label) => (
            <li
              key={`m:${label}`}
              className="flex h-8 items-center gap-1 rounded-full border border-line-strong bg-raised pl-3 pr-1 text-[13px] leading-5 text-ink"
            >
              {label}
              <button
                type="button"
                onClick={() => remove(label)}
                aria-label={t('synonyms.remove', { label })}
                title={t('synonyms.remove', { label })}
                className="flex size-6 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-raised-hover hover:text-ink"
              >
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <TextInput
          id={id}
          value={text}
          maxLength={SYNONYM_MAX}
          disabled={full}
          placeholder={t(full ? 'synonyms.full' : 'synonyms.placeholder', { n: SYNONYMS_PER_ITEM })}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active > 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-10 mt-1 flex flex-col gap-0.5 rounded-[12px] border border-line-strong bg-card p-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)]"
          >
            {suggestions.map((label, i) => (
              <li
                key={label}
                id={`${listId}-${i + 1}`}
                role="option"
                aria-selected={active === i + 1}
                // Before the field's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(label);
                }}
                className={cx(
                  'flex h-10 cursor-pointer items-center rounded-[8px] px-3 text-[14px] leading-5 text-ink',
                  active === i + 1 ? 'bg-raised' : 'hover:bg-raised',
                )}
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-[13px] leading-5 text-danger">{error}</p>
      ) : (
        <p className="text-[13px] leading-5 text-ink-3">{t('synonyms.hint')}</p>
      )}
    </div>
  );
}

import type { Category } from '@dnd/shared';
import { Check, Pipette, Plus, Shapes, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useCategories, useDeleteCategory, useSaveCategory } from '../api/hooks';
import { EditorFooter } from '../editors/EditorFooter';
import { useI18n } from '../i18n';
import { CATEGORY_PALETTE, textOn } from './categoryColors';
import { Dialog } from './Dialog';
import { IconPicker } from './IllustrationField';
import { matches } from './Page';
import { Button, cx, ErrorNote, Field, IconButton, TextInput } from './ui';

/**
 * A category as a small colored label: its icon and name on its own color. Icon markup
 * comes from the server's copy of the icon sets.
 */
export function CategoryChip({
  category,
  className,
}: {
  category: Pick<Category, 'name' | 'color' | 'icon'>;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-5 font-medium',
        className,
      )}
      style={{ background: category.color, color: textOn(category.color) }}
    >
      {category.icon && (
        <span
          className="svg-fill block size-3.5 shrink-0"
          aria-hidden
          dangerouslySetInnerHTML={{ __html: category.icon.svg }}
        />
      )}
      <span className="truncate">{category.name}</span>
    </span>
  );
}

/** True when the item carries one of the chosen categories, or when none is chosen. */
export function inCategories(item: { categoryIds: string[] }, chosen: string[]): boolean {
  return chosen.length === 0 || item.categoryIds.some((id) => chosen.includes(id));
}

/**
 * The user's categories as a row of toggles over a list: tapping one keeps the items that
 * carry it; several chosen keep the items carrying any of them. Hidden while the user has
 * no category. Scrolls sideways when the row is longer than the screen.
 */
export function CategoryFilter({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const all = useCategories().data ?? [];
  if (all.length === 0) return null;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div
      role="group"
      aria-label={t('categories.filter')}
      // A sideways scroller clips vertically too: py leaves room for the chosen ring and the
      // focus outline (4px each outside the chip), -my keeps the row where it was.
      className="scroll-quiet -mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 md:-mx-8 md:px-8"
    >
      <button
        type="button"
        aria-pressed={value.length === 0}
        onClick={() => onChange([])}
        className={cx(
          'h-8 shrink-0 rounded-full border px-3 text-[13px] leading-5 transition-colors duration-150',
          value.length === 0
            ? 'border-line-strong bg-raised text-ink'
            : 'border-line text-ink-2 hover:text-ink',
        )}
      >
        {t('categories.all')}
      </button>
      {all.map((category) => {
        const on = value.includes(category.id);
        return (
          <button
            key={category.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(category.id)}
            className={cx(
              'shrink-0 rounded-full transition-opacity duration-150',
              // Unchosen ones stay in their color, dimmed, so each is found by its color.
              on || value.length === 0 ? 'opacity-100' : 'opacity-45 hover:opacity-80',
            )}
          >
            <CategoryChip
              category={category}
              className={cx('h-8', on && 'ring-2 ring-ink ring-offset-2 ring-offset-page')}
            />
          </button>
        );
      })}
    </div>
  );
}

/** Creates a category (with a name typed in the field) or edits one, over the editor. */
export function CategoryDialog({
  category,
  initialName = '',
  onClose,
  onSaved,
}: {
  category: Category | null;
  initialName?: string;
  onClose: () => void;
  onSaved?: (category: Category) => void;
}) {
  const { t, errorText } = useI18n();
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const [name, setName] = useState(category?.name ?? initialName);
  const [color, setColor] = useState<string>(category?.color ?? CATEGORY_PALETTE[0]);
  const [icon, setIcon] = useState<Category['icon']>(category?.icon ?? null);
  const [picking, setPicking] = useState(false);
  const error = save.error ?? remove.error;
  const fields = error instanceof ApiError ? error.fields : undefined;
  const custom = !(CATEGORY_PALETTE as readonly string[]).includes(color);

  const submit = () =>
    save.mutate(
      { id: category?.id, body: { name: name.trim(), color, iconId: icon?.iconId ?? null } },
      {
        onSuccess: (saved) => {
          onSaved?.(saved);
          onClose();
        },
      },
    );

  return (
    <Dialog
      title={t(category ? 'categories.edit' : 'categories.new')}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <EditorFooter
          onCancel={onClose}
          onDelete={category ? () => remove.mutate(category.id, { onSuccess: onClose }) : undefined}
          confirmText={t('categories.confirmDelete')}
          saving={save.isPending}
          deleting={remove.isPending}
          canSave={name.trim().length > 0}
        />
      }
    >
      {error && !fields && <ErrorNote>{errorText(error)}</ErrorNote>}

      <div className="flex min-h-11 items-center">
        <CategoryChip category={{ name: name.trim() || t('categories.preview'), color, icon }} />
      </div>

      <Field label={t('common.name')} error={fields?.name}>
        {(id) => (
          <TextInput id={id} value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-[13px] leading-5 text-ink-2">{t('categories.color')}</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              aria-pressed={color === swatch}
              onClick={() => setColor(swatch)}
              className={cx(
                'flex size-11 items-center justify-center rounded-full border-2 transition-colors duration-150',
                color === swatch ? 'border-ink' : 'border-transparent',
              )}
            >
              <span className="flex size-8 items-center justify-center rounded-full" style={{ background: swatch }}>
                {color === swatch && <Check size={16} strokeWidth={2} style={{ color: textOn(swatch) }} aria-hidden />}
              </span>
            </button>
          ))}
          {/* Any other color, through the system's own picker. */}
          <label
            title={t('categories.customColor')}
            className={cx(
              'relative flex size-11 cursor-pointer items-center justify-center rounded-full border-2 transition-colors duration-150',
              custom ? 'border-ink' : 'border-transparent',
            )}
          >
            <span
              className="flex size-8 items-center justify-center rounded-full border border-line-strong"
              style={custom ? { background: color } : undefined}
            >
              <Pipette size={16} strokeWidth={1.5} aria-hidden style={{ color: custom ? textOn(color) : undefined }} />
            </span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label={t('categories.customColor')}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>
        {fields?.color && <p className="text-[13px] leading-5 text-danger">{fields.color}</p>}
      </fieldset>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('categories.icon')}</span>
        <div className="flex items-center gap-2">
          <Button icon={Shapes} onClick={() => setPicking(true)}>
            {t('illustration.icon')}
          </Button>
          <IconButton
            icon={Trash2}
            label={t('illustration.none')}
            disabled={!icon}
            onClick={() => setIcon(null)}
          />
        </div>
      </div>

      {picking && (
        <Dialog title={t('illustration.icon')} onClose={() => setPicking(false)} fixedHeight>
          <IconPicker
            selected={icon?.iconId ?? null}
            onPick={(iconId, svg) => {
              setIcon({ iconId, svg });
              setPicking(false);
            }}
          />
        </Dialog>
      )}
    </Dialog>
  );
}

const SUGGESTIONS_SHOWN = 8;

/**
 * The user's own categories on an item. Typing filters their categories; "Create" opens
 * a new one with the typed name over the editor, and adds it once saved. Tapping a chip
 * edits that category; its "x" only takes it off this item.
 */
export function CategoryField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const listId = useId();
  const all = useCategories().data;
  const byId = useMemo(() => new Map((all ?? []).map((c) => [c.id, c])), [all]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<{ category: Category | null; name: string } | null>(null);

  // A category deleted from its dialog leaves the item too, or saving would send its id.
  useEffect(() => {
    if (all && value.some((cid) => !byId.has(cid))) onChange(value.filter((cid) => byId.has(cid)));
  }, [all, byId, value, onChange]);

  const chosen = value.flatMap((cid) => byId.get(cid) ?? []);
  const query = text.trim();
  const options = (all ?? [])
    .filter((c) => !value.includes(c.id) && (query === '' || matches(c.name, query)))
    .slice(0, SUGGESTIONS_SHOWN);
  const canCreate = query !== '' && !(all ?? []).some((c) => c.name === query);
  const count = options.length + (canCreate ? 1 : 0);
  const showList = open && count > 0;

  const pick = (category: Category) => {
    onChange([...value, category.id]);
    setText('');
    setActive(0);
  };
  const create = () => {
    setEditing({ category: null, name: query });
    setText('');
    setOpen(false);
  };
  const choose = (index: number) => {
    if (index < options.length) pick(options[index]!);
    else if (canCreate) create();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showList) choose(active);
    } else if (e.key === 'ArrowDown' && showList) {
      e.preventDefault();
      setActive((a) => Math.min(count - 1, a + 1));
    } else if (e.key === 'ArrowUp' && showList) {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Escape' && showList) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const option = (index: number, content: ReactNode) => (
    <li
      key={index}
      id={`${listId}-${index}`}
      role="option"
      aria-selected={active === index}
      onMouseDown={(e) => {
        e.preventDefault();
        choose(index);
      }}
      className={cx(
        'flex min-h-10 cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1 text-[14px] leading-5 text-ink',
        active === index ? 'bg-raised' : 'hover:bg-raised',
      )}
    >
      {content}
    </li>
  );

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-5 text-ink-2">
        {t('categories.label')}
      </label>
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('categories.label')}>
          {chosen.map((category) => (
            <li key={category.id} className="flex items-center">
              <button
                type="button"
                onClick={() => setEditing({ category, name: category.name })}
                title={t('categories.editItem', { name: category.name })}
                className="rounded-full"
              >
                <CategoryChip category={category} className="rounded-r-none pr-2" />
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((cid) => cid !== category.id))}
                aria-label={t('categories.removeFrom', { name: category.name })}
                title={t('categories.removeFrom', { name: category.name })}
                className="flex h-7 items-center rounded-r-full pr-2 pl-1"
                style={{ background: category.color, color: textOn(category.color) }}
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
          maxLength={40}
          placeholder={t('categories.placeholder')}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
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
            {options.map((category, i) => option(i, <CategoryChip category={category} />))}
            {canCreate &&
              option(
                options.length,
                <>
                  <Plus size={16} strokeWidth={1.5} aria-hidden className="text-ink-2" />
                  <span className="truncate">{t('categories.create', { name: query })}</span>
                </>,
              )}
          </ul>
        )}
      </div>
      {editing && (
        <CategoryDialog
          category={editing.category}
          initialName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            if (!value.includes(saved.id)) onChange([...value, saved.id]);
          }}
        />
      )}
    </div>
  );
}

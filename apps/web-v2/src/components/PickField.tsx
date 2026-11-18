import { ListChecks, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { PickList, type PickItem } from './PickList';
import { Button } from './ui';

const NAMES_SHOWN = 3;

/**
 * A PickList kept out of the editor: the editor shows what is chosen in one line, and the
 * full checklist, with its search, opens over it. Choices apply as they are ticked.
 */
export function PickField({
  label,
  items,
  selected,
  onChange,
  fallback,
  emptyText,
  max,
  disabled,
}: {
  label: string;
  items: PickItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  fallback: LucideIcon;
  emptyText: string;
  max?: number;
  disabled?: boolean;
}) {
  const { t, tn } = useI18n();
  const [open, setOpen] = useState(false);
  const byId = new Map(items.map((item) => [item.id, item.name]));
  const names = selected.flatMap((id) => byId.get(id) ?? []);
  const summary =
    names.length === 0
      ? t('common.noneSelected')
      : names.slice(0, NAMES_SHOWN).join(', ') +
        (names.length > NAMES_SHOWN ? ` +${names.length - NAMES_SHOWN}` : '');

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-baseline justify-between text-[13px] leading-5 text-ink-2">
        {label}
        <span className="text-[12px] text-ink-3 tabular-nums">{tn('common.selected', selected.length)}</span>
      </span>
      <div className="flex min-h-14 items-center gap-3 rounded-[12px] border border-line bg-raised/40 py-2 pl-4 pr-2">
        <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink-2">{summary}</span>
        <Button icon={ListChecks} disabled={disabled} onClick={() => setOpen(true)} className="px-3">
          {t('common.choose')}
        </Button>
      </div>
      {open && (
        <Dialog
          title={label}
          onClose={() => setOpen(false)}
          footer={
            <Button variant="primary" onClick={() => setOpen(false)} className="ml-auto">
              {t('common.done')}
            </Button>
          }
        >
          <PickList
            label={label}
            items={items}
            selected={selected}
            onChange={onChange}
            fallback={fallback}
            emptyText={emptyText}
            max={max}
          />
        </Dialog>
      )}
    </div>
  );
}

import type { Mix } from '@dnd/shared';
import { Globe, Lock, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Dialog } from '../components/Dialog';
import { Thumb } from '../components/Illustration';
import { KIND_ICONS } from '../components/kinds';
import { Button, cx, Field, Icon, Segmented } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Before an item turns private: what it is taken out of. It is removed from the user's
 * public mixes that hold it (they stay public), and leaves the library of everyone who
 * added it. Nothing else changes, so confirming only saves the item.
 */
export function UnpublishDialog({
  holders,
  addedCount,
  busy,
  onConfirm,
  onClose,
}: {
  /** The user's own public mixes and playlists that hold the item. */
  holders: Mix[];
  /** How many other users have it in their library. */
  addedCount: number;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t, tn } = useI18n();
  return (
    <Dialog
      title={t('unpublish.title')}
      onClose={onClose}
      onSubmit={onConfirm}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={busy} disabled={busy}>
            {t('unpublish.confirm')}
          </Button>
        </>
      }
    >
      {holders.length > 0 && (
        <>
          <p className="text-[14px] leading-5 text-ink-2">
            {t('unpublish.holders', { n: holders.length })}
          </p>
          <ul className="flex flex-col gap-1.5">
            {holders.map((holder) => (
              <li key={holder.id} className="flex items-center gap-3">
                <Thumb value={holder.illustration} fallback={KIND_ICONS[holder.kind]} size="size-8" />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">
                  {holder.name}
                </span>
                <span className="shrink-0 text-[12px] leading-4 text-ink-3">
                  {t('unpublish.staysPublic')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {addedCount > 0 && (
        <p className="text-[14px] leading-5 text-ink-2">{tn('unpublish.added', addedCount)}</p>
      )}
      <p className="text-[13px] leading-5 text-ink-3">{t('unpublish.note')}</p>
    </Dialog>
  );
}

/** Private or public, with what each means. */
export function VisibilityField({
  value,
  onChange,
  note,
  error,
}: {
  value: boolean;
  onChange: (isPublic: boolean) => void;
  /** A constraint that applies to this item, shown under the hint. */
  note?: string;
  error?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] leading-5 text-ink-2">{t('share.visibility')}</span>
      <Segmented
        label={t('share.visibility')}
        value={value ? 'public' : 'private'}
        onChange={(v) => onChange(v === 'public')}
        options={[
          { value: 'private', label: t('share.private'), icon: Lock },
          { value: 'public', label: t('share.public'), icon: Globe },
        ]}
      />
      <p className={cx('text-[13px] leading-5', error ? 'text-danger' : 'text-ink-3')}>
        {error ?? (
          <>
            {t(value ? 'share.public.hint' : 'share.private.hint')}
            {note && value ? `. ${note}` : ''}
          </>
        )}
      </p>
    </div>
  );
}

/** Says who owns an item the viewer only added from the library. */
export function OwnerNote({ name }: { name: string }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 rounded-[10px] border border-line bg-deep px-3 py-2.5 text-[14px] leading-5 text-ink-2">
      <Icon icon={UserRound} className="text-ink-3" />
      {t('share.ownedBy', { name })}
    </p>
  );
}

/** Fields of an item added from the library: shown, greyed out, and out of reach. */
export function OwnerOnly({ locked, children }: { locked: boolean; children: ReactNode }) {
  if (!locked) return <>{children}</>;
  return (
    <fieldset disabled aria-disabled className="flex min-w-0 flex-col gap-6 opacity-45">
      {children}
    </fieldset>
  );
}

/** An optional multi-line text, such as a description. */
export function TextArea({
  label,
  name,
  value,
  onChange,
  maxLength,
  required,
  hint,
  error,
}: {
  label: string;
  /** The form field name, when the textarea is part of a form the browser posts. */
  name?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  /** The browser's own validation: the form does not post while it is empty. */
  required?: boolean;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <textarea
          id={id}
          name={name}
          value={value}
          required={required}
          maxLength={maxLength}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-24 w-full resize-y rounded-[10px] border border-line bg-raised px-3 py-2.5 text-[15px] leading-6 text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-0 focus:outline-lamp"
        />
      )}
    </Field>
  );
}

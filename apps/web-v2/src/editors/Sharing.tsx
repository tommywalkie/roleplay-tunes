import { Globe, Lock, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx, Field, Icon, Segmented } from '../components/ui';
import { useI18n } from '../i18n';

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
  value,
  onChange,
  maxLength,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id) => (
        <textarea
          id={id}
          value={value}
          maxLength={maxLength}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-24 w-full resize-y rounded-[10px] border border-line bg-raised px-3 py-2.5 text-[15px] leading-6 text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-line-strong focus:border-line-strong focus:outline-2 focus:outline-offset-0 focus:outline-lamp"
        />
      )}
    </Field>
  );
}

import { LICENSE_MAX } from '@dnd/shared';
import { useState } from 'react';
import { Field, Select, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

/**
 * Options whose wording depends on the language are saved as a code and shown translated.
 * License names (CC BY 4.0, ...) are the same in every language and are saved as they are.
 */
const CODED: Record<string, MessageKey> = {
  unknown: 'license.unknown',
  'private-use': 'license.private',
};

/**
 * The note a license carries under its name: what its terms mean in practice, above all
 * about using the sound in a stream. A value not listed here has no note.
 */
const HINTS: Record<string, MessageKey> = {
  unknown: 'license.unknown.hint',
  'private-use': 'license.private.hint',
  'Pixabay Content License': 'license.pixabay.hint',
  'CC0 1.0': 'license.cc0.hint',
  'CC BY 4.0': 'license.by.hint',
  'CC BY-SA 4.0': 'license.bySa.hint',
  'CC BY-NC 4.0': 'license.byNc.hint',
  'CC BY-NC-SA 4.0': 'license.byNcSa.hint',
  'CC BY-ND 4.0': 'license.byNd.hint',
  'CC BY-NC-ND 4.0': 'license.byNcNd.hint',
};

/** The note for a saved license value, or nothing when it has none. */
export function licenseHint(value: string): MessageKey | undefined {
  return HINTS[value];
}
const NAMED = [
  'Pixabay Content License',
  'CC0 1.0',
  'CC BY 4.0',
  'CC BY-SA 4.0',
  'CC BY-NC 4.0',
  'CC BY-NC-SA 4.0',
  'CC BY-ND 4.0',
  'CC BY-NC-ND 4.0',
];
const LISTED = [...Object.keys(CODED), ...NAMED];
const CUSTOM = '__custom__';

/** The text to show for a saved license value, in the reader's language. */
export function licenseText(value: string, t: (key: MessageKey) => string): string {
  const key = CODED[value];
  return key ? t(key) : value;
}

/**
 * A license from the list, or "Other" to type one. The value stays one string: empty when
 * never set, a code or a license name from the list, or the typed text.
 */
export function LicenseField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useI18n();
  const listed = value === '' || LISTED.includes(value);
  const [custom, setCustom] = useState(!listed);
  // The select shows `unknown` for a sound with no license, so its note matches.
  const hintKey = custom ? undefined : licenseHint(value || 'unknown');

  const choose = (choice: string) => {
    if (choice === CUSTOM) {
      setCustom(true);
      if (listed) onChange('');
      return;
    }
    setCustom(false);
    onChange(choice);
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label={t('sounds.license')} hint={t('license.intro')} error={custom ? undefined : error}>
        {(id) => (
          // A sound saved before the list existed has no license: it reads as unknown.
          <Select id={id} value={custom ? CUSTOM : value || 'unknown'} onChange={(e) => choose(e.target.value)}>
            {LISTED.map((option) => (
              <option key={option} value={option}>
                {licenseText(option, t)}
              </option>
            ))}
            <option value={CUSTOM}>{t('license.custom')}</option>
          </Select>
        )}
      </Field>
      {!custom && hintKey && (
        <p className="-mt-2 text-[13px] leading-5 text-ink-3">
          <span className="font-medium text-ink-2">{t('license.effect')}</span>{' '}
          {t(hintKey)}
        </p>
      )}
      {custom && (
        <Field label={t('license.customLabel')} error={error}>
          {(id) => (
            <TextInput
              id={id}
              value={value}
              maxLength={LICENSE_MAX}
              autoFocus
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </Field>
      )}
    </div>
  );
}

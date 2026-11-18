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
      <Field label={t('sounds.license')} error={custom ? undefined : error}>
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
      {custom && (
        <Field label={t('license.customLabel')} hint={t('sounds.licenseHint')} error={error}>
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

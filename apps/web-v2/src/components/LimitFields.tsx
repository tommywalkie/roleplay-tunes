import { LIMIT_KEYS, MAX_LIMITS, type LimitKey, type Limits } from '@dnd/shared';
import { useI18n, type I18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Field, TextInput } from './ui';

const MB = 1024 * 1024;

/** Limits are stored in bytes and seconds; people type megabytes and minutes. */
const UNITS: Record<LimitKey, { size: number; unit?: MessageKey; label: MessageKey }> = {
  storageBytes: { size: MB, unit: 'unit.mb', label: 'settings.storage' },
  audioFileBytes: { size: MB, unit: 'unit.mb', label: 'limit.audioFileBytes' },
  audioDurationSec: { size: 60, unit: 'unit.min', label: 'limit.audioDurationSec' },
  imageFileBytes: { size: MB, unit: 'unit.mb', label: 'limit.imageFileBytes' },
  mixItems: { size: 1, label: 'limit.mixItems' },
};

export type LimitInputs = Record<LimitKey, string>;

/** Text for the inputs. `null` (no override) is an empty field. */
export function toLimitInputs(values: Record<LimitKey, number | null>): LimitInputs {
  const out = {} as LimitInputs;
  for (const key of LIMIT_KEYS) {
    const value = values[key];
    out[key] = value === null ? '' : String(Math.round((value / UNITS[key].size) * 100) / 100);
  }
  return out;
}

/** Stored values from the inputs: empty or unreadable is `null`, the rest is clamped. */
export function fromLimitInputs(inputs: LimitInputs): Record<LimitKey, number | null> {
  const out = {} as Record<LimitKey, number | null>;
  for (const key of LIMIT_KEYS) {
    const text = inputs[key].trim().replace(',', '.');
    const number = Number(text);
    out[key] =
      text === '' || !Number.isFinite(number)
        ? null
        : Math.min(MAX_LIMITS[key], Math.max(0, Math.round(number * UNITS[key].size)));
  }
  return out;
}

/** A limit as people read it: `500 MB`, `10 min`, `50`. */
export function formatLimit(key: LimitKey, value: number, i18n: Pick<I18n, 't' | 'bytes'>): string {
  if (key === 'audioDurationSec') {
    return i18n.t('duration.minutes', { n: Math.round((value / 60) * 100) / 100 });
  }
  return key === 'mixItems' ? String(value) : i18n.bytes(value);
}

/** The five limits as number fields. With `defaults`, an empty field means "use the default". */
export function LimitFields({
  value,
  onChange,
  defaults,
}: {
  value: LimitInputs;
  onChange: (value: LimitInputs) => void;
  defaults?: Limits;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {LIMIT_KEYS.map((key) => {
        const { unit, label } = UNITS[key];
        return (
          <Field
            key={key}
            label={unit ? `${t(label)}, ${t(unit)}` : t(label)}
            hint={
              defaults
                ? t('admin.user.default', { value: formatLimit(key, defaults[key], i18n) })
                : undefined
            }
          >
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={value[key]}
                onChange={(e) => onChange({ ...value, [key]: e.target.value })}
                className="font-mono tabular-nums"
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

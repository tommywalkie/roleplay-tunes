import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALES as SHARED_LOCALES, type Locale as SharedLocale } from '@dnd/shared';
import { ApiError } from '../api/client';
import { en, type MessageKey, type Messages } from './en';
import { fr } from './fr';

/** The languages the app speaks, and the ones the server rules are written in. */
export const LOCALES = SHARED_LOCALES;
export type Locale = SharedLocale;
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

const MESSAGES: Record<Locale, Messages> = { en, fr };
const STORAGE_KEY = 'ambiance.locale';

type Vars = Record<string, string | number>;
/** Base of a plural pair: `count.sounds` for `count.sounds_one` / `count.sounds_other`. */
type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}_one`
    ? Base
    : never
  : never;

export interface I18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural form for `n`, with `{n}` filled in. */
  tn: (key: PluralKey, n: number) => string;
  /** A user-facing sentence for any thrown value. */
  errorText: (error: unknown) => string;
  bytes: (n: number) => string;
  duration: (sec: number) => string;
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // Storage blocked: fall through to the browser language.
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr')
    ? 'fr'
    : 'en';
}

function fill(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : text;
}

const UNITS = { en: ['B', 'KB', 'MB', 'GB', 'TB'], fr: ['o', 'Ko', 'Mo', 'Go', 'To'] } as const;

export function formatBytes(n: number, locale: Locale): string {
  let value = Math.max(0, n);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.en.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return `${number} ${UNITS[locale][unit]}`;
}

/** `0:07`, `3:20`, `1:02:05`. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function createI18n(locale: Locale, setLocale: (l: Locale) => void = () => {}): I18n {
  const messages = MESSAGES[locale];
  const t: I18n['t'] = (key, vars) => fill(messages[key] ?? en[key] ?? key, vars);
  return {
    locale,
    setLocale,
    t,
    tn: (key, n) => t(`${key}_${n === 1 || (locale === 'fr' && n === 0) ? 'one' : 'other'}` as MessageKey, { n }),
    errorText: (error) => {
      if (error instanceof ApiError) {
        const key = `error.${error.code}` as MessageKey;
        return key in messages ? t(key) : t('error.internal');
      }
      return t('error.internal');
    },
    bytes: (n) => formatBytes(n, locale),
    duration: formatDuration,
  };
}

const I18nContext = createContext<I18n>(createI18n('en'));

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectLocale());
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(() => createI18n(locale, setLocale), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

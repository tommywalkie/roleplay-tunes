import {
  Beer,
  Check,
  CloudRain,
  DoorOpen,
  Download,
  Flame,
  Trees,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '../api/client';
import { useAcceptTerms, usePublicSettings, useSignIn, useSignUp, useTerms } from '../api/hooks';
import { Credit, Mark, Wordmark } from '../components/Brand';
import { InstallDialog, runsInstalled } from '../components/InstallDialog';
import { TermsDialog } from '../components/TermsDialog';
import { Button, cx, ErrorNote, Field, Lamp, Segmented, TextInput } from '../components/ui';
import { LOCALES, LOCALE_NAMES, useI18n, type Locale } from '../i18n';

/** A still of the board, drawn in code: what the product is, before signing in. */
const PREVIEW: { icon: LucideIcon; name: Record<Locale, string>; meta: string; on?: boolean }[] = [
  { icon: Users, name: { en: 'Tavern crowd', fr: 'Foule de taverne' }, meta: '2:48', on: true },
  { icon: Flame, name: { en: 'Fireplace', fr: 'Feu de cheminée' }, meta: '1:30', on: true },
  { icon: Beer, name: { en: 'Mug on the table', fr: 'Chope sur la table' }, meta: '0:02' },
  { icon: DoorOpen, name: { en: 'Door creak', fr: 'Porte qui grince' }, meta: '0:04' },
  {
    icon: CloudRain,
    name: { en: 'Rain on the roof', fr: 'Pluie sur le toit' },
    meta: '3:12',
    on: true,
  },
  { icon: Trees, name: { en: 'Night forest', fr: 'Forêt de nuit' }, meta: '4:05' },
];

function BoardPreview() {
  const { locale } = useI18n();
  return (
    <ul aria-hidden className="grid w-full max-w-[520px] grid-cols-3 gap-3">
      {PREVIEW.map(({ icon: Glyph, name, meta, on }) => (
        <li
          key={name.en}
          className={cx(
            'overflow-hidden rounded-[14px] border bg-card',
            on ? 'border-lamp/70' : 'border-line',
          )}
        >
          <span className="flex aspect-[4/3] items-center justify-center bg-deep/40">
            <Glyph strokeWidth={1.25} className={cx('size-12', on ? 'text-lamp' : 'text-ink-3')} />
          </span>
          <span className="flex flex-col gap-0.5 px-3 pb-3 pt-2.5">
            <span className="flex items-center gap-2">
              <Lamp on={Boolean(on)} />
              <span className="truncate text-[14px] leading-5 font-medium">{name[locale]}</span>
            </span>
            <span className="pl-4 font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
              {meta}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LoginPage() {
  const { t, errorText, locale, setLocale } = useI18n();
  const termsId = useId();
  const settings = usePublicSettings();
  const signIn = useSignIn();
  const signUp = useSignUp();
  const terms = useTerms(locale);
  const accept = useAcceptTerms();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [installing, setInstalling] = useState(false);
  const [reading, setReading] = useState(false);
  // The reader reached the foot of the rules, and then said so with the checkbox.
  const [readToEnd, setReadToEnd] = useState(false);
  const [read, setRead] = useState(false);

  // Another language is another text, possibly of another length: the reader has to reach
  // its end again before the box unlocks, and un-tick what they ticked in the last one.
  useEffect(() => {
    setRead(false);
    setReadToEnd(false);
  }, [locale]);

  const creating = mode === 'up';
  const active = creating ? signUp : signIn;
  const fields = active.error instanceof ApiError ? active.error.fields : undefined;
  const hasTerms = Boolean(terms.data?.enabled && terms.data.html !== '');
  const mustRead = creating && hasTerms;
  const canSubmit =
    email.trim().length > 0 &&
    password.length > 0 &&
    (!creating || name.trim().length > 0) &&
    (!mustRead || read);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (creating) {
      signUp.mutate(
        { name: name.trim(), email: email.trim(), password },
        // The account exists now: record that it accepted the rules it just read.
        { onSuccess: () => accept.mutate() },
      );
    } else {
      signIn.mutate({ email: email.trim(), password });
    }
  };
  const switchMode = () => {
    signIn.reset();
    signUp.reset();
    setRead(false);
    setReadToEnd(false);
    setMode(creating ? 'in' : 'up');
  };

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      <main className="flex flex-col px-6 py-10 md:px-12">
        {/* The same control Settings shows for the same setting, and the same choice it
            saves: what language this screen, and the rules under it, are written in. It
            holds once the account opens, and survives a reload. */}
        <div className="self-end">
          <Segmented
            label={t('settings.language')}
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
          />
        </div>
        <div className="my-auto flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2.5 text-ink-2">
              <Mark size={24} />
              <Wordmark name={t('app.name')} />
            </span>
            <h1 className="text-[32px] leading-10 font-medium">
              {t(creating ? 'signup.title' : 'login.title')}
            </h1>
            <p className="text-[15px] leading-[22px] text-ink-2">{t('login.subtitle')}</p>
          </div>

          <form onSubmit={submit} noValidate className="flex w-full max-w-[360px] flex-col gap-4">
            {active.error && <ErrorNote>{errorText(active.error)}</ErrorNote>}
            {creating && (
              <Field label={t('login.name')} error={fields?.name}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={name}
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Field label={t('login.email')} error={fields?.email}>
              {(id) => (
                <TextInput
                  id={id}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={t('login.password')}
              hint={creating ? t('signup.passwordHint') : undefined}
              error={fields?.password}
            >
              {(id) => (
                <TextInput
                  id={id}
                  type="password"
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            {mustRead && (
              <div className="flex flex-col gap-1">
                <div className="flex min-h-11 items-start gap-3">
                  <input
                    id={termsId}
                    type="checkbox"
                    // The sentence is split between the label and the link, so the box is
                    // named by the whole of it rather than by its first half.
                    aria-label={`${t('terms.agree')} ${t('terms.link')}`}
                    checked={read}
                    disabled={!readToEnd}
                    onChange={(e) => setRead(e.target.checked)}
                    className="sr-only"
                  />
                  <label
                    htmlFor={termsId}
                    className={cx(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-150',
                      read ? 'border-ink bg-ink text-deep' : 'border-line-strong bg-deep',
                      readToEnd ? 'cursor-pointer' : 'cursor-default opacity-50',
                    )}
                  >
                    {read && <Check size={14} strokeWidth={2} aria-hidden />}
                  </label>
                  <p className={cx('text-[14px] leading-5', readToEnd ? 'text-ink' : 'text-ink-3')}>
                    <label htmlFor={termsId} className="cursor-pointer">
                      {t('terms.agree')}
                    </label>{' '}
                    <button
                      type="button"
                      onClick={() => setReading(true)}
                      className="underline underline-offset-4 transition-colors duration-150 hover:text-white"
                    >
                      {t('terms.link')}
                    </button>
                  </p>
                </div>
              </div>
            )}
            <Button
              type="submit"
              variant="primary"
              busy={active.isPending}
              disabled={!canSubmit}
              className="mt-2"
            >
              {t(creating ? 'signup.submit' : 'login.submit')}
            </Button>
            {(settings.data?.signupsOpen || creating) && (
              <button
                type="button"
                onClick={switchMode}
                className="h-11 self-start rounded-[10px] text-[14px] leading-5 text-ink-2 underline-offset-4 transition-colors duration-150 hover:text-ink hover:underline"
              >
                {t(creating ? 'signup.toLogin' : 'login.toSignUp')}
              </button>
            )}
          </form>
          {!runsInstalled() && (
            <Button
              variant="ghost"
              icon={Download}
              onClick={() => setInstalling(true)}
              className="-ml-3 self-start px-3"
            >
              {t('install.button')}
            </Button>
          )}
        </div>
        <Credit className="pt-10" />
      </main>
      {installing && <InstallDialog onClose={() => setInstalling(false)} />}
      {reading && (
        <TermsDialog
          mode={{ kind: 'read' }}
          updating={false}
          onClose={() => setReading(false)}
          onReadToEnd={() => setReadToEnd(true)}
        />
      )}

      <div className="hidden items-center justify-center border-l border-line bg-deep p-12 lg:flex">
        <BoardPreview />
      </div>
    </div>
  );
}

import { Beer, CloudRain, DoorOpen, Flame, Trees, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { usePublicSettings, useSignIn, useSignUp } from '../api/hooks';
import { Mark, Wordmark } from '../components/Brand';
import { Button, cx, ErrorNote, Field, Lamp, TextInput } from '../components/ui';
import { useI18n, type Locale } from '../i18n';

/** A still of the board, drawn in code: what the product is, before signing in. */
const PREVIEW: { icon: LucideIcon; name: Record<Locale, string>; meta: string; on?: boolean }[] = [
  { icon: Users, name: { en: 'Tavern crowd', fr: 'Foule de taverne' }, meta: '2:48', on: true },
  { icon: Flame, name: { en: 'Fireplace', fr: 'Feu de cheminée' }, meta: '1:30', on: true },
  { icon: Beer, name: { en: 'Mug on the table', fr: 'Chope sur la table' }, meta: '0:02' },
  { icon: DoorOpen, name: { en: 'Door creak', fr: 'Porte qui grince' }, meta: '0:04' },
  { icon: CloudRain, name: { en: 'Rain on the roof', fr: 'Pluie sur le toit' }, meta: '3:12', on: true },
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
            <span className="pl-4 font-mono text-[12px] leading-4 text-ink-3 tabular-nums">{meta}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LoginPage() {
  const { t, errorText } = useI18n();
  const settings = usePublicSettings();
  const signIn = useSignIn();
  const signUp = useSignUp();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const creating = mode === 'up';
  const active = creating ? signUp : signIn;
  const fields = active.error instanceof ApiError ? active.error.fields : undefined;
  const canSubmit =
    email.trim().length > 0 && password.length > 0 && (!creating || name.trim().length > 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (creating) signUp.mutate({ name: name.trim(), email: email.trim(), password });
    else signIn.mutate({ email: email.trim(), password });
  };
  const switchMode = () => {
    signIn.reset();
    signUp.reset();
    setMode(creating ? 'in' : 'up');
  };

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      <main className="flex flex-col justify-center gap-8 px-6 py-10 md:px-12">
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
          <Button type="submit" variant="primary" busy={active.isPending} disabled={!canSubmit} className="mt-2">
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
      </main>

      <div className="hidden items-center justify-center border-l border-line bg-deep p-12 lg:flex">
        <BoardPreview />
      </div>
    </div>
  );
}

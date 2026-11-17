import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useResetPassword } from '../api/admin';
import { Button, ErrorNote, Field, TextInput } from '../components/ui';
import { useI18n } from '../i18n';

/** Where a reset link from an admin lands: choose a new password, then sign in. */
export function ResetPasswordPage() {
  const { t, errorText } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const reset = useResetPassword();
  const [password, setPassword] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length >= 8 && token) reset.mutate({ token, newPassword: password });
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-8 px-6 py-10 md:px-12">
      <div className="flex flex-col gap-2">
        <span className="text-[15px] leading-5 text-ink-2">{t('app.name')}</span>
        <h1 className="text-[32px] leading-10 font-medium">
          {t(reset.isSuccess ? 'reset.done' : 'reset.title')}
        </h1>
      </div>

      {reset.isSuccess ? (
        <Link
          to="/"
          className="inline-flex h-11 items-center self-start rounded-[10px] bg-ink px-4 text-[14px] leading-5 font-medium text-deep transition-colors duration-150 hover:bg-white"
        >
          {t('reset.toLogin')}
        </Link>
      ) : (
        <form onSubmit={submit} noValidate className="flex w-full max-w-[360px] flex-col gap-4">
          {!token && <ErrorNote>{t('error.invalid_token')}</ErrorNote>}
          {reset.error && <ErrorNote>{errorText(reset.error)}</ErrorNote>}
          <Field label={t('reset.newPassword')} hint={t('signup.passwordHint')}>
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="primary"
            busy={reset.isPending}
            disabled={password.length < 8 || !token}
            className="mt-2"
          >
            {t('reset.submit')}
          </Button>
        </form>
      )}
    </main>
  );
}

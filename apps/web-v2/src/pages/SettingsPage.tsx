import type { Me } from '@dnd/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useUpdateMe } from '../api/hooks';
import { Page } from '../components/Page';
import { StorageMeter } from '../components/StorageMeter';
import { Button, ErrorNote, Field, Segmented, TextInput } from '../components/ui';
import { LOCALE_NAMES, LOCALES, useI18n } from '../i18n';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-[16px] border border-line bg-card p-5">
      <h2 className="text-[13px] leading-5 text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-t border-line pt-2 first:border-t-0 first:pt-0">
      <dt className="text-[14px] leading-5 text-ink-2">{label}</dt>
      <dd className="text-[14px] leading-5 tabular-nums">{value}</dd>
    </div>
  );
}

/** The pseudonym others see on what the user shares, with its own save button. */
function NameForm({ me }: { me: Me }) {
  const { t, errorText } = useI18n();
  const update = useUpdateMe();
  const [name, setName] = useState(me.name);
  const trimmed = name.trim();
  const changed = trimmed !== me.name && trimmed.length > 0;
  const fields = update.error instanceof ApiError ? update.error.fields : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (changed) update.mutate({ name: trimmed });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      {update.error && !fields?.name && <ErrorNote>{errorText(update.error)}</ErrorNote>}
      <Field label={t('login.name')} hint={t('login.name.hint')} error={fields?.name}>
        {(id) => (
          <div className="flex gap-2">
            <TextInput
              id={id}
              value={name}
              maxLength={100}
              autoComplete="nickname"
              onChange={(e) => {
                setName(e.target.value);
                update.reset();
              }}
            />
            <Button type="submit" busy={update.isPending} disabled={!changed}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Field>
      <p className="h-5 text-[13px] leading-5 text-ink-3" role="status">
        {update.isSuccess && !changed ? t('settings.nameSaved') : ''}
      </p>
    </form>
  );
}

export function SettingsPage({ me }: { me: Me }) {
  const { t, tn, bytes, locale, setLocale } = useI18n();

  return (
    <Page title={t('settings.title')}>
      <div className="grid max-w-[880px] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={t('settings.storage')}>
          <StorageMeter me={me} />
          <dl className="flex flex-col gap-2 pt-2">
            <Row label={t('nav.sounds')} value={tn('count.sounds', me.usage.sounds)} />
            <Row label={t('nav.mixes')} value={tn('count.mixes', me.usage.mixes)} />
            <Row label={t('nav.scenes')} value={tn('count.scenes', me.usage.scenes)} />
          </dl>
        </Card>

        <Card title={t('settings.limits')}>
          <dl className="flex flex-col gap-2">
            <Row label={t('limit.audioFileBytes')} value={bytes(me.limits.audioFileBytes)} />
            <Row
              label={t('limit.audioDurationSec')}
              value={t('duration.minutes', { n: Math.floor(me.limits.audioDurationSec / 60) })}
            />
            <Row label={t('limit.imageFileBytes')} value={bytes(me.limits.imageFileBytes)} />
            <Row label={t('limit.mixItems')} value={String(me.limits.mixItems)} />
          </dl>
        </Card>

        <Card title={t('settings.account')}>
          <NameForm me={me} />
          <div className="flex flex-col gap-1">
            <span className="truncate text-[14px] leading-5 text-ink-2">{me.email}</span>
            <span className="text-[13px] leading-5 text-ink-3">
              {t(me.role === 'admin' ? 'settings.role.admin' : 'settings.role.user')}
            </span>
          </div>
        </Card>

        <Card title={t('settings.language')}>
          <Segmented
            label={t('settings.language')}
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
          />
        </Card>
      </div>
    </Page>
  );
}

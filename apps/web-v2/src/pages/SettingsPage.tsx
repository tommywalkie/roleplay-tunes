import type { Me } from '@dnd/shared';
import type { ReactNode } from 'react';
import { Page } from '../components/Page';
import { StorageMeter } from '../components/StorageMeter';
import { Segmented } from '../components/ui';
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
          <div className="flex flex-col gap-1">
            <span className="truncate text-[17px] leading-6 font-medium">{me.name}</span>
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

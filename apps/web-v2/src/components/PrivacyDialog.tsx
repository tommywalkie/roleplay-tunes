import { ChartColumn, Database, Send, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Dialog } from './Dialog';
import { Button, Icon } from './ui';

/** The day the notice last changed. Bump it whenever the wording below changes. */
const PRIVACY_UPDATED = '2026-11-19';

/** One titled part of the notice. */
function Section({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-[15px] leading-6 font-medium text-ink">
        <Icon icon={icon} className="text-ink-3" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A short list, one item per key. */
function Bullets({ keys }: { keys: MessageKey[] }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-1.5">
      {keys.map((key) => (
        <li key={key} className="flex items-start gap-2 text-[14px] leading-5 text-ink-2">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-3" />
          {t(key)}
        </li>
      ))}
    </ul>
  );
}

/**
 * What this server keeps about a user, in plain language, in sections. Written by the app,
 * not by the server rules: the same words everywhere, unlike the terms an administrator
 * authors. The instance names itself from the address the reader is on.
 */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const { hostname, origin } = window.location;
  const [beforeHost, afterHost] = t('privacy.overview.body', { app: t('app.name') }).split('{host}');
  const updated = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(
    new Date(PRIVACY_UPDATED),
  );

  return (
    <Dialog
      title={t('privacy.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} className="ml-auto">
          {t('common.close')}
        </Button>
      }
    >
      <p className="text-[12px] leading-4 text-ink-3">{t('privacy.updated', { date: updated })}</p>

      <Section icon={ShieldCheck} title={t('privacy.overview.title')}>
        <p className="text-[14px] leading-5 text-ink-2">
          {beforeHost}
          <a
            href={origin}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 transition-colors duration-150 hover:text-ink"
          >
            {hostname}
          </a>
          {afterHost}
        </p>
      </Section>

      <Section icon={Database} title={t('privacy.data.title')}>
        <Bullets
          keys={[
            'privacy.data.account',
            'privacy.data.session',
            'privacy.data.language',
            'privacy.data.items',
          ]}
        />
        <p className="text-[14px] leading-5 text-ink-2">{t('privacy.data.visibility')}</p>
      </Section>

      <Section icon={ChartColumn} title={t('privacy.analytics.title')}>
        <p className="text-[14px] leading-5 text-ink-2">{t('privacy.analytics.body')}</p>
      </Section>

      <Section icon={Send} title={t('privacy.contact.title')}>
        <p className="text-[14px] leading-5 text-ink-2">{t('privacy.contact.body')}</p>
      </Section>
    </Dialog>
  );
}

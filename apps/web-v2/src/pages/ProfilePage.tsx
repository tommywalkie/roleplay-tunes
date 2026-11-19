import type { Me } from '@dnd/shared';
import {
  Award,
  ChevronRight,
  Download,
  Lock,
  LogOut,
  Mail,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useChangelog, useSignOut, useTerms } from '../api/hooks';
import { Credit } from '../components/Brand';
import { ChangelogDialog } from '../components/ChangelogDialog';
import { CONTACT_FORM_ENABLED, ContactDialog } from '../components/ContactDialog';
import { CreditsDialog } from '../components/CreditsDialog';
import { InstallDialog, runsInstalled } from '../components/InstallDialog';
import { initials } from '../components/OwnerBadge';
import { PrivacyDialog } from '../components/PrivacyDialog';
import { TermsDialog } from '../components/TermsDialog';
import { Button, ErrorNote, Icon } from '../components/ui';
import { useI18n } from '../i18n';

/** The account at a glance, and the way to everything about it. */
export function ProfilePage({ me }: { me: Me }) {
  const { t, errorText, locale } = useI18n();
  const signOut = useSignOut();
  const [installing, setInstalling] = useState(false);
  const [reading, setReading] = useState(false);
  const [readingNotes, setReadingNotes] = useState(false);
  const [open, setOpen] = useState<'credits' | 'contact' | 'privacy' | null>(null);
  const terms = useTerms(locale);
  const notes = useChangelog(locale);
  // Nothing to read while the administrator has not written the rules for this language.
  const hasTerms = Boolean(terms.data?.enabled && terms.data.html !== '');

  return (
    <div className="mx-auto flex w-full max-w-[560px] animate-enter flex-col gap-6 px-4 pb-10 pt-6 md:px-8 md:pt-8">
      <h1 className="sr-only">{t('profile.title')}</h1>
      <section className="flex flex-col items-center gap-4 rounded-[20px] border border-line bg-card px-6 pb-8 pt-10 text-center">
        <span
          aria-hidden
          className="flex size-24 items-center justify-center rounded-full border border-line-strong bg-raised text-[32px] leading-10 font-medium text-ink"
        >
          {initials(me.name)}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] leading-5 text-ink-3">{t('profile.label')}</span>
          <span className="truncate text-[24px] leading-8 font-medium">{me.name}</span>
          <span className="truncate text-[14px] leading-5 text-ink-2">{me.email}</span>
        </div>
      </section>

      <ul className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-card">
        <Row icon={Settings} title={t('nav.settings')} hint={t('profile.settings.hint')} to="/settings" />
        <Row
          icon={Tags}
          title={t('categories.label')}
          hint={t('profile.categories.hint')}
          to="/categories"
        />
        {hasTerms && (
          <Row
            icon={ScrollText}
            title={t('terms.title')}
            hint={t('profile.terms.hint')}
            onClick={() => setReading(true)}
          />
        )}
        <Row
          icon={Sparkles}
          title={t('changelog.title')}
          hint={t('profile.changelog.hint', { version: notes.data?.latest ?? '' })}
          onClick={() => setReadingNotes(true)}
        />
        <Row
          icon={Award}
          title={t('credits.title')}
          hint={t('profile.credits.hint')}
          onClick={() => setOpen('credits')}
        />
        <Row
          icon={Lock}
          title={t('privacy.title')}
          hint={t('profile.privacy.hint')}
          onClick={() => setOpen('privacy')}
        />
        {CONTACT_FORM_ENABLED && (
          <Row
            icon={Mail}
            title={t('contact.title')}
            hint={t('profile.contact.hint')}
            onClick={() => setOpen('contact')}
          />
        )}
        {me.role === 'admin' && (
          <Row
            icon={ShieldCheck}
            title={t('profile.admin')}
            hint={t('profile.admin.hint')}
            to="/admin"
          />
        )}
        {!runsInstalled() && (
          <Row
            icon={Download}
            title={t('install.button')}
            hint={t('install.hint')}
            onClick={() => setInstalling(true)}
          />
        )}
      </ul>

      {signOut.error && <ErrorNote>{errorText(signOut.error)}</ErrorNote>}
      <Button
        icon={LogOut}
        busy={signOut.isPending}
        onClick={() => signOut.mutate()}
        className="w-full text-danger"
      >
        {t('settings.signOut')}
      </Button>

      {/* From the width where the navigation rail shows its own credit. */}
      <Credit className="items-center text-center lg:hidden" />

      {installing && <InstallDialog onClose={() => setInstalling(false)} />}
      {reading && (
        <TermsDialog mode={{ kind: 'read' }} updating={false} onClose={() => setReading(false)} />
      )}
      {readingNotes && <ChangelogDialog onClose={() => setReadingNotes(false)} />}
      {open === 'credits' && <CreditsDialog onClose={() => setOpen(null)} />}
      {open === 'privacy' && <PrivacyDialog onClose={() => setOpen(null)} />}
      {open === 'contact' && <ContactDialog me={me} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A big row of the profile: a link to a page, or a button that opens something. */
function Row({
  icon,
  title,
  hint,
  to,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  to?: string;
  onClick?: () => void;
}) {
  const className =
    'flex min-h-18 w-full items-center gap-4 px-5 py-3 text-left transition-colors duration-150 hover:bg-raised/60';
  const body = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised text-ink-2">
        <Icon icon={icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] leading-6 font-medium">{title}</span>
        <span className="truncate text-[13px] leading-5 text-ink-3">{hint}</span>
      </span>
      <Icon icon={ChevronRight} className="text-ink-3" />
    </>
  );
  return (
    <li className="border-t border-line first:border-t-0">
      {to ? (
        <Link to={to} className={className}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={className}>
          {body}
        </button>
      )}
    </li>
  );
}

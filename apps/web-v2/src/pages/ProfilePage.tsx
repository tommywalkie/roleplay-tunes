import type { Me } from '@dnd/shared';
import { ChevronRight, LogOut, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useSignOut } from '../api/hooks';
import { Button, ErrorNote, Icon } from '../components/ui';
import { useI18n } from '../i18n';

/** Up to two letters for the avatar: the first letters of the first two words of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/** The account at a glance, and the way to everything about it. */
export function ProfilePage({ me }: { me: Me }) {
  const { t, errorText } = useI18n();
  const signOut = useSignOut();

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
        <LinkRow to="/settings" icon={Settings} title={t('nav.settings')} hint={t('profile.settings.hint')} />
        {me.role === 'admin' && (
          <LinkRow
            to="/admin"
            icon={ShieldCheck}
            title={t('profile.admin')}
            hint={t('profile.admin.hint')}
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
    </div>
  );
}

function LinkRow({
  to,
  icon,
  title,
  hint,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        to={to}
        className="flex min-h-18 items-center gap-4 px-5 py-3 transition-colors duration-150 hover:bg-raised/60"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised text-ink-2">
          <Icon icon={icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-6 font-medium">{title}</span>
          <span className="truncate text-[13px] leading-5 text-ink-3">{hint}</span>
        </span>
        <Icon icon={ChevronRight} className="text-ink-3" />
      </Link>
    </li>
  );
}

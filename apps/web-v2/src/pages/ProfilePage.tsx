import type { Me } from '@dnd/shared';
import {
  ChevronRight,
  Download,
  EllipsisVertical,
  LogOut,
  Settings,
  Share,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useSignOut } from '../api/hooks';
import { Credit } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { Button, ErrorNote, Icon } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

/** Up to two letters for the avatar: the first letters of the first two words of the name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((w) => [...w][0] ?? '');
  return letters.join('').toLocaleUpperCase() || '?';
}

/** True when the page runs as the installed app rather than in a browser tab. */
function runsInstalled(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

/** The account at a glance, and the way to everything about it. */
export function ProfilePage({ me }: { me: Me }) {
  const { t, errorText } = useI18n();
  const signOut = useSignOut();
  const [installing, setInstalling] = useState(false);

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

/** How to add the app to the home screen, step by step, for people who never did it. */
function InstallDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t('install.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} className="ml-auto">
          {t('install.done')}
        </Button>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('install.intro')}</p>
      <Steps
        title={t('install.android')}
        steps={['install.android.1', 'install.android.2', 'install.android.3']}
        icons={[EllipsisVertical]}
      />
      <Steps
        title={t('install.ios')}
        steps={['install.ios.1', 'install.ios.2', 'install.ios.3']}
        icons={[Share]}
      />
    </Dialog>
  );
}

/** Numbered steps. `icons[i]` shows the button that step talks about, as it looks on screen. */
function Steps({
  title,
  steps,
  icons,
}: {
  title: string;
  steps: MessageKey[];
  icons: LucideIcon[];
}) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[15px] leading-6 font-medium">{title}</h3>
      <ol className="flex flex-col gap-3">
        {steps.map((key, i) => (
          <Step key={key} n={i + 1} icon={icons[i]}>
            {t(key)}
          </Step>
        ))}
      </ol>
    </section>
  );
}

function Step({ n, icon, children }: { n: number; icon?: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[12px] leading-4 text-ink-2 tabular-nums">
        {n}
      </span>
      <span className="flex min-w-0 flex-1 items-start gap-2 pt-0.5 text-[14px] leading-5 text-ink">
        <span>{children}</span>
        {icon && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-[6px] border border-line bg-raised text-ink-2">
            <Icon icon={icon} className="size-4" />
          </span>
        )}
      </span>
    </li>
  );
}

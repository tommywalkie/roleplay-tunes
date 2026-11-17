import type { Me } from '@dnd/shared';
import { AudioLines, Layers, Map as MapIcon, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useSounds } from '../api/hooks';
import { PlayerProvider } from '../audio/player';
import { Mark, Wordmark } from '../components/Brand';
import { StorageMeter } from '../components/StorageMeter';
import { cx, Icon } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { PlayerPanel } from '../player/PlayerPanel';

const NAV: { to: string; label: MessageKey; icon: LucideIcon }[] = [
  { to: '/scenes', label: 'nav.scenes', icon: MapIcon },
  { to: '/mixes', label: 'nav.mixes', icon: Layers },
  { to: '/sounds', label: 'nav.sounds', icon: AudioLines },
  { to: '/settings', label: 'nav.settings', icon: Settings },
];
/** Shown to administrators only. */
const ADMIN_NAV = { to: '/admin', label: 'nav.admin', icon: ShieldCheck } as const;

/**
 * The signed-in frame: navigation, the page, and the player, which is always on screen.
 * Phones get a tab bar with the player docked above it; wider screens get a navigation
 * rail on the left and the player as a column on the right.
 */
export function AppShell({ me }: { me: Me }) {
  const { t } = useI18n();
  const sounds = useSounds().data ?? [];
  const nav = me.role === 'admin' ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <PlayerProvider sounds={sounds}>
      <div className="grid h-dvh grid-cols-1 md:grid-cols-[72px_minmax(0,1fr)_320px] lg:grid-cols-[232px_minmax(0,1fr)_344px]">
        <nav
          aria-label={t('app.name')}
          className="hidden flex-col border-r border-line bg-deep md:flex"
        >
          <div className="flex h-20 items-center justify-center gap-3 px-5 lg:justify-start">
            <Mark />
            <span className="hidden lg:block">
              <Wordmark name={t('app.name')} />
            </span>
          </div>
          <ul className="flex flex-col gap-1 px-3">
            {nav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  title={t(item.label)}
                  className={({ isActive }) =>
                    cx(
                      'flex h-11 items-center justify-center gap-3 rounded-[10px] text-[15px] leading-5 lg:justify-start lg:px-3',
                      'transition-[background-color,color] duration-150',
                      isActive
                        ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
                        : 'text-ink-2 hover:bg-raised/60 hover:text-ink',
                    )
                  }
                >
                  <Icon icon={item.icon} />
                  <span className="sr-only lg:not-sr-only">{t(item.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <div className="mt-auto hidden px-5 pb-6 lg:block">
            <NavLink to="/settings" className="block rounded-[10px]" aria-label={t('settings.storage')}>
              <StorageMeter me={me} compact />
            </NavLink>
          </div>
        </nav>

        <main className="scroll-quiet min-w-0 overflow-y-auto pb-[calc(120px+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>

        <PlayerPanel sounds={sounds} />

        <nav
          aria-label={t('app.name')}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-deep pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <ul className="grid h-14 auto-cols-fr grid-flow-col">
            {nav.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cx(
                      'flex h-full flex-col items-center justify-center gap-1 text-[12px] leading-4 transition-colors duration-150',
                      isActive ? 'text-ink' : 'text-ink-3',
                    )
                  }
                >
                  <Icon icon={item.icon} />
                  {t(item.label)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PlayerProvider>
  );
}

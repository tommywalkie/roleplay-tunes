import type { Me, Sound } from '@dnd/shared';
import {
  AudioLines,
  CircleUserRound,
  Layers,
  LibraryBig,
  Map as MapIcon,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useLibrary, useScenes, useSounds } from '../api/hooks';
import { MixEditor, type ItemDraft } from '../editors/MixEditor';
import { PlayerProvider } from '../audio/player';
import { Credit, Mark, Wordmark } from '../components/Brand';
import { StorageMeter } from '../components/StorageMeter';
import { cx, Icon } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { PlayerPanel } from '../player/PlayerPanel';

interface NavItem {
  to: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Other addresses under which this item shows as the current one. */
  also?: string[];
}

/** The tab bar on phones: five places, Settings and Admin are reached from Profile. */
const TABS: NavItem[] = [
  { to: '/scenes', label: 'nav.scenes', icon: MapIcon },
  { to: '/mixes', label: 'nav.mixes', icon: Layers },
  { to: '/sounds', label: 'nav.sounds', icon: AudioLines },
  { to: '/library', label: 'nav.library', icon: LibraryBig },
  { to: '/profile', label: 'nav.profile', icon: CircleUserRound, also: ['/settings', '/admin'] },
];
/** The rail on wider screens has room for Settings and, for administrators, Admin. */
const RAIL_EXTRA: NavItem[] = [{ to: '/settings', label: 'nav.settings', icon: Settings }];
const ADMIN_NAV: NavItem = { to: '/admin', label: 'nav.admin', icon: ShieldCheck };

/** Sounds the player can play: the user's own and added ones, and the public ones to preview. */
function playableSounds(own: Sound[], library: Sound[]): Sound[] {
  const ids = new Set(own.map((s) => s.id));
  return [...own, ...library.filter((s) => !ids.has(s.id))];
}

/**
 * The signed-in frame: navigation, the page, and the player, which is always on screen.
 * Phones get a tab bar with the player docked above it; wider screens get a navigation
 * rail on the left and the player as a column on the right.
 */
export function AppShell({ me }: { me: Me }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const own = useSounds().data;
  const library = useLibrary().data?.sounds;
  const sounds = useMemo(() => playableSounds(own ?? [], library ?? []), [own, library]);
  const scenes = useScenes().data;
  // A mix holds the user's own and added sounds only: a library sound played as a preview
  // has to be added first.
  const ownIds = useMemo(() => new Set((own ?? []).map((s) => s.id)), [own]);
  const [newMixItems, setNewMixItems] = useState<ItemDraft[] | null>(null);
  const rail = [
    ...TABS.map((item) => ({ ...item, also: undefined })),
    ...RAIL_EXTRA,
    ...(me.role === 'admin' ? [ADMIN_NAV] : []),
  ];
  const isCurrent = (item: NavItem, active: boolean) =>
    active || (item.also?.some((path) => pathname.startsWith(path)) ?? false);

  return (
    <PlayerProvider sounds={sounds}>
      {/* Phones and tablets: tab bar and docked player. Desktop: rail and player column. */}
      <div className="grid h-full grid-cols-1 lg:grid-cols-[232px_minmax(0,1fr)_344px]">
        <nav
          aria-label={t('app.name')}
          className="hidden flex-col border-r border-line bg-deep lg:flex"
        >
          <div className="flex h-20 items-center justify-center gap-3 px-5 lg:justify-start">
            <Mark />
            <span className="hidden lg:block">
              <Wordmark name={t('app.name')} />
            </span>
          </div>
          <ul className="flex flex-col gap-1 px-3">
            {rail.map((item) => (
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
            <hr className="my-5 border-line" />
            <Credit className='gap-2.5 items-center text-center' />
          </div>
        </nav>

        {/* Its own stacking context: nothing in a page can paint over the player or the tab bar. */}
        <main className="scroll-quiet relative z-0 min-w-0 overflow-y-auto pb-[calc(120px+var(--safe-bottom))] lg:pb-0">
          <Outlet />
        </main>

        <PlayerPanel sounds={sounds} onSaveAsMix={setNewMixItems} />
        {newMixItems && (
          <MixEditor
            mix={null}
            sounds={own ?? []}
            scenes={scenes ?? []}
            me={me}
            initialItems={newMixItems.filter((item) => ownIds.has(item.soundId))}
            onClose={() => setNewMixItems(null)}
          />
        )}

        <nav
          aria-label={t('app.name')}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-deep pb-[var(--safe-bottom)] lg:hidden"
        >
          <ul className="grid h-14 auto-cols-fr grid-flow-col">
            {TABS.map((item) => (
              <li key={item.to} className="min-w-0">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cx(
                      'flex h-full flex-col items-center justify-center gap-1 px-1 text-[12px] leading-4 transition-colors duration-150',
                      isCurrent(item, isActive) ? 'text-ink' : 'text-ink-3',
                    )
                  }
                >
                  <Icon icon={item.icon} />
                  <span className="max-w-full truncate">{t(item.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </PlayerProvider>
  );
}

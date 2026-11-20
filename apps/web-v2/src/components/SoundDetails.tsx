import type { Sound } from '@dnd/shared';
import {
  Calendar,
  Clapperboard,
  Disc3,
  Gamepad2,
  Globe,
  Tv,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { Icon } from './ui';

/**
 * What a sound is from, one entry per field: the icon says which field it is, so only the
 * owner's own words are shown. Shared by the editor (which lays the fields out as inputs)
 * and the library card (which shows the ones that are filled).
 */
export const SOUND_DETAILS: { key: keyof SoundMeta; icon: LucideIcon; label: MessageKey }[] = [
  { key: 'artists', icon: Users, label: 'soundMeta.artists' },
  { key: 'year', icon: Calendar, label: 'soundMeta.year' },
  { key: 'movie', icon: Clapperboard, label: 'soundMeta.movie' },
  { key: 'game', icon: Gamepad2, label: 'soundMeta.game' },
  { key: 'tv', icon: Tv, label: 'soundMeta.tv' },
  { key: 'album', icon: Disc3, label: 'soundMeta.album' },
  { key: 'url', icon: Globe, label: 'soundMeta.url' },
];

export type SoundMeta = Pick<Sound, 'artists' | 'year' | 'movie' | 'game' | 'tv' | 'album' | 'url'>;
export type SoundMetaKey = keyof SoundMeta;

/** A link reads as its own address, shortened: the name of the site it points at. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Where a sound comes from, as its card in the library shows it: the fields the owner
 * filled, each behind the icon of what it is. The description is not here; it reads below.
 */
export function SoundDetails({ sound }: { sound: SoundMeta }) {
  const { t } = useI18n();
  const filled = SOUND_DETAILS.filter(({ key }) => sound[key]);
  if (filled.length === 0) return null;

  return (
    <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-ink-3">
      {filled.map(({ key, icon, label }) => (
        <li key={key} className="flex min-w-0 items-center gap-1.5">
          <Icon icon={icon} className="text-ink-3" />
          <span className="sr-only">{t(label)}</span>
          {key === 'url' ? (
            <a
              href={sound[key] ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate underline decoration-line-strong underline-offset-2 hover:text-ink"
            >
              {hostOf(sound[key] as string)}
            </a>
          ) : (
            <span className="min-w-0 truncate">{sound[key]}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

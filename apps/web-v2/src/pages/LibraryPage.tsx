import type { Illustration, Mix, Sound } from '@dnd/shared';
import { Check, Play, Plus, Square, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useLibrary, useLibraryEntry, useSounds } from '../api/hooks';
import { usePlayer } from '../audio/player';
import { Thumb } from '../components/Illustration';
import { FALLBACK_ICONS, MODE_ICONS, MODE_LABELS } from '../components/kinds';
import { CategoryFilter, inCategories } from '../components/Categories';
import { matches, NoMatch, Page, QueryGate, searchText } from '../components/Page';
import { Button, cx, EmptyState, Icon, IconButton, Lamp, Segmented } from '../components/ui';
import { licenseText } from '../editors/LicenseField';
import { useI18n } from '../i18n';
import { initials } from './ProfilePage';

type Tab = 'sounds' | 'mixes';

/** By creation time, newest first. ISO dates sort as text. */
const newestFirst = <T extends { createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

/** Every public sound and mix: listen first, then add what you like to your own library. */
export function LibraryPage() {
  const { t, tn } = useI18n();
  const library = useLibrary();
  const [tab, setTab] = useState<Tab>('sounds');
  const [query, setQuery] = useState('');

  const own = useSounds().data;
  // Newest first, so what was just shared sits at the top.
  const sounds = useMemo(() => newestFirst(library.data?.sounds ?? []), [library.data?.sounds]);
  const mixes = useMemo(() => newestFirst(library.data?.mixes ?? []), [library.data?.mixes]);
  // A public mix may use public sounds or the user's own: either can draw its stack.
  const soundsById = useMemo(
    () => new Map([...(own ?? []), ...(library.data?.sounds ?? [])].map((s) => [s.id, s])),
    [own, library.data?.sounds],
  );
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const searchable = (item: Sound | Mix) =>
    `${searchText(item)}\n${item.ownerName}\n${item.description ?? ''}`;
  const keep = (item: Sound | Mix) =>
    matches(searchable(item), query) && inCategories(item, categoryIds);
  const shownSounds = sounds.filter(keep);
  const shownMixes = mixes.filter(keep);
  const empty = sounds.length + mixes.length === 0;

  return (
    <Page
      title={t('library.title')}
      description={t('library.description')}
      meta={library.data ? String(sounds.length + mixes.length) : undefined}
      search={{ value: query, onChange: setQuery }}
      filters={<CategoryFilter value={categoryIds} onChange={setCategoryIds} />}
    >
      <QueryGate
        loading={library.isLoading}
        error={library.error}
        onRetry={() => void library.refetch()}
      >
        {empty ? (
          <EmptyState
            icon={FALLBACK_ICONS.sound}
            title={t('library.empty.title')}
            body={t('library.empty.body')}
          />
        ) : (
          <div className="flex max-w-[880px] flex-col gap-4">
            <div className="max-w-[360px]">
              <Segmented
                label={t('library.title')}
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'sounds', label: tn('count.sounds', shownSounds.length) },
                  { value: 'mixes', label: tn('count.mixes', shownMixes.length) },
                ]}
              />
            </div>
            {tab === 'sounds' ? (
              sounds.length === 0 ? (
                <EmptyState
                  icon={FALLBACK_ICONS.sound}
                  title={t('library.noSounds.title')}
                  body={t('library.noSounds.body')}
                />
              ) : shownSounds.length === 0 ? (
                <NoMatch query={query.trim()} />
              ) : (
                <ul className="flex flex-col rounded-[16px] border border-line bg-card">
                  {shownSounds.map((sound) => (
                    <SoundRow key={sound.id} sound={sound} />
                  ))}
                </ul>
              )
            ) : mixes.length === 0 ? (
              <EmptyState
                icon={FALLBACK_ICONS.mix}
                title={t('library.noMixes.title')}
                body={t('library.noMixes.body')}
              />
            ) : shownMixes.length === 0 ? (
              <NoMatch query={query.trim()} />
            ) : (
              <ul className="flex flex-col rounded-[16px] border border-line bg-card">
                {shownMixes.map((mix) => (
                  <MixRow key={mix.id} mix={mix} soundsById={soundsById} />
                ))}
              </ul>
            )}
          </div>
        )}
      </QueryGate>
    </Page>
  );
}

function SoundRow({ sound }: { sound: Sound }) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const entry = useLibraryEntry('sounds');
  const ModeIcon = MODE_ICONS[sound.defaultMode];
  return (
    <Row
      name={sound.name}
      illustration={sound.illustration}
      fallback={FALLBACK_ICONS.sound}
      what={
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            <ModeIcon size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
            <span className="truncate">{t(MODE_LABELS[sound.defaultMode])}</span>
          </span>
          <span className="font-mono text-[12px] tabular-nums">{duration(sound.durationSec)}</span>
        </>
      }
      owner={sound.ownerName}
      description={sound.description}
      license={sound.license}
      playing={player.isSoundPlaying(sound.id)}
      onPlay={() => player.toggleSound(sound)}
      action={
        <AddButton
          name={sound.name}
          access={sound.access}
          busy={entry.isPending}
          onAdd={() => entry.mutate({ id: sound.id, add: true })}
        />
      }
    />
  );
}

const MIX_THUMBS = 4;

function MixRow({ mix, soundsById }: { mix: Mix; soundsById: Map<string, Sound> }) {
  const { tn } = useI18n();
  const player = usePlayer();
  const entry = useLibraryEntry('mixes');
  const inside = mix.items.slice(0, MIX_THUMBS).map((item) => soundsById.get(item.soundId));
  return (
    <Row
      name={mix.name}
      illustration={mix.illustration}
      fallback={FALLBACK_ICONS.mix}
      what={
        <>
          {/* The sounds it is made of, as a small overlapping stack of their pictures. */}
          {inside.length > 0 && (
            <span className="flex shrink-0 items-center pl-1.5" aria-hidden>
              {inside.map((sound, i) => (
                <Thumb
                  key={mix.items[i]!.id}
                  value={sound?.illustration ?? { type: 'none' }}
                  fallback={FALLBACK_ICONS.sound}
                  className="-ml-1.5 size-5 rounded-[5px] ring-2 ring-card [&_svg]:size-3"
                />
              ))}
            </span>
          )}
          <span className="truncate">{tn('count.sounds', mix.items.length)}</span>
        </>
      }
      owner={mix.ownerName}
      description={mix.description}
      playing={player.isMixPlaying(mix.id)}
      onPlay={() => player.toggleMix(mix)}
      action={
        <AddButton
          name={mix.name}
          access={mix.access}
          busy={entry.isPending}
          onAdd={() => entry.mutate({ id: mix.id, add: true })}
        />
      }
    />
  );
}

function Row({
  name,
  illustration,
  fallback,
  what,
  owner,
  description,
  license,
  playing,
  onPlay,
  action,
}: {
  name: string;
  illustration: Illustration;
  fallback: LucideIcon;
  /** What the item is, under its name: a sound's mode and length, a mix's sounds. */
  what: ReactNode;
  /** Who shared it, shown with their initials at the foot of the row. */
  owner: string;
  description: string | null;
  license?: string | null;
  playing: boolean;
  onPlay: () => void;
  action: ReactNode;
}) {
  const { t } = useI18n();
  // Phones: the description and the bottom line use the full row width, under the
  // thumbnail. From tablet width they line up with the name.
  const below = 'col-span-3 md:col-start-2 md:col-end-4';
  return (
    <li className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 md:grid-cols-[56px_minmax(0,1fr)_auto] md:gap-x-4 md:px-5 md:py-4">
      <Thumb
        value={illustration}
        fallback={fallback}
        lit={playing}
        className="size-12 rounded-[10px] md:size-14"
      />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <Lamp on={playing} />
          <span className="truncate text-[15px] leading-6 font-medium">{name}</span>
        </span>
        <span className="flex h-5 min-w-0 items-center gap-3 pl-4 text-[13px] leading-5 text-ink-3">
          {what}
        </span>
      </div>
      <IconButton
        icon={playing ? Square : Play}
        label={t(playing ? 'library.stop' : 'library.play', { name })}
        aria-pressed={playing}
        onClick={onPlay}
        variant="secondary"
        className={playing ? 'text-lamp hover:text-lamp' : undefined}
      />
      {description && (
        <p className={cx(below, 'line-clamp-3 text-[14px] leading-5 text-ink-2 md:line-clamp-2')}>
          {description}
        </p>
      )}
      <div className={cx(below, 'flex min-h-11 items-center gap-3')}>
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-raised text-[10px] leading-none font-medium text-ink-2"
          >
            {initials(owner)}
          </span>
          <span className="sr-only">{t('library.by', { name: owner })}</span>
          <span aria-hidden className="truncate text-[13px] leading-5 text-ink-2">
            {owner}
          </span>
        </span>
        {license && (
          // Set like a small label stuck on the item, so it reads apart from the owner.
          <span
            title={t('library.license', { license: licenseText(license, t) })}
            className="min-w-0 truncate rounded-[6px] border border-line px-1.5 text-[12px] leading-5 text-ink-3"
          >
            <span className="sr-only">{t('library.license', { license: licenseText(license, t) })}</span>
            <span aria-hidden>{licenseText(license, t)}</span>
          </span>
        )}
        <span className="ml-auto shrink-0">{action}</span>
      </div>
    </li>
  );
}

function AddButton({
  name,
  access,
  busy,
  onAdd,
}: {
  name: string;
  access: Sound['access'];
  busy: boolean;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  // Yours and Added are states, not actions: quiet text, so only Add reads as a button.
  if (access === 'owner') {
    return <span className="shrink-0 text-[13px] leading-5 text-ink-3">{t('library.yours')}</span>;
  }
  if (access === 'added') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[13px] leading-5 text-ink-2">
        <Icon icon={Check} />
        {t('library.added')}
      </span>
    );
  }
  return (
    <Button
      icon={Plus}
      busy={busy}
      onClick={onAdd}
      aria-label={t('library.addItem', { name })}
      className="px-3"
    >
      {t('library.add')}
    </Button>
  );
}

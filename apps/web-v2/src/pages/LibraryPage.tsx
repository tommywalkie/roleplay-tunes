import type { Illustration, Mix, Sound } from '@dnd/shared';
import { Check, Play, Plus, Square, Trash2, type LucideIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useLibrary, useLibraryEntry, useMixes, useScenes, useSounds } from '../api/hooks';
import { usePlayer } from '../audio/player';
import { Thumb } from '../components/Illustration';
import { LicenseBadge } from '../components/LicenseBadge';
import { OwnerBadge } from '../components/OwnerBadge';
import { AddMixDialog, RemoveMixDialog } from '../components/MixLibraryDialogs';
import { RemoveSoundDialog, soundUsage } from '../components/RemoveSoundDialog';
import { FALLBACK_ICONS, MODE_ICONS, MODE_LABELS } from '../components/kinds';
import { CategoryFilter, inCategories } from '../components/Categories';
import {
  matches,
  NoMatch,
  Page,
  Pagination,
  QueryGate,
  searchText,
  usePages,
} from '../components/Page';
import { Button, EmptyState, IconButton, Lamp, Segmented, cx } from '../components/ui';
import { useI18n } from '../i18n';

type Tab = 'sounds' | 'mixes';

/** By creation time, newest first. ISO dates sort as text. */
const newestFirst = <T extends { createdAt: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

/** Every public sound and mix: listen first, then add what you like to your own library. */
export function LibraryPage() {
  const { t, tn } = useI18n();
  const library = useLibrary();
  const own = useSounds();
  const ownMixes = useMixes();
  const ownScenes = useScenes();
  const [tab, setTab] = useState<Tab>('sounds');
  const [query, setQuery] = useState('');
  // A mix being added or taken out opens a dialog over the list: what it holds decides
  // what happens to its sounds, and that is not a one-tap answer.
  const [adding, setAdding] = useState<Mix | null>(null);
  const [removing, setRemoving] = useState<Mix | null>(null);
  const [removingSound, setRemovingSound] = useState<Sound | null>(null);

  // Newest first, so what was just shared sits at the top.
  const sounds = useMemo(() => newestFirst(library.data?.sounds ?? []), [library.data?.sounds]);
  const mixes = useMemo(() => newestFirst(library.data?.mixes ?? []), [library.data?.mixes]);
  // A public mix may use public sounds or the user's own: either can draw its stack.
  const byId = useMemo(
    () => new Map([...(own.data ?? []), ...(library.data?.sounds ?? [])].map((s) => [s.id, s])),
    [own.data, library.data?.sounds],
  );
  /** Sounds the user can use already: their own, added outright, or inside a mix of theirs. */
  const heldIds = useMemo(() => {
    const ids = new Set<string>((own.data ?? []).map((s) => s.id));
    for (const sound of library.data?.sounds ?? [])
      if (sound.access !== 'available') ids.add(sound.id);
    for (const mix of ownMixes.data ?? []) for (const item of mix.items) ids.add(item.soundId);
    // Only a mix the user actually added brings its sounds to them: a public mix of
    // somebody else that holds the same sound proves nothing.
    for (const mix of library.data?.mixes ?? []) {
      if (mix.access === 'available') continue;
      for (const item of mix.items) ids.add(item.soundId);
    }
    return ids;
  }, [own.data, library.data?.sounds, ownMixes.data, library.data?.mixes]);

  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  // One hook for the whole list: a removal in flight greys every row's button, not just its own.
  const soundsEntry = useLibraryEntry('sounds');
  /** What the user owns, to say where an added sound sits before it goes. */
  const board = useMemo(
    () => ({ mixes: ownMixes.data ?? [], scenes: ownScenes.data ?? [] }),
    [ownMixes.data, ownScenes.data],
  );
  const searchable = (item: Sound | Mix) =>
    `${searchText(item)}\n${item.ownerName}\n${item.description ?? ''}`;
  const keep = (item: Sound | Mix) =>
    matches(searchable(item), query) && inCategories(item, categoryIds);
  const shownSounds = sounds.filter(keep);
  const shownMixes = mixes.filter(keep);
  const empty = sounds.length + mixes.length === 0;
  const filterKey = `${tab}\n${query}\n${categoryIds.join()}`;
  const soundPages = usePages(shownSounds, filterKey);
  const mixPages = usePages(shownMixes, filterKey);
  const pages = tab === 'sounds' ? soundPages : mixPages;

  return (
    <Page
      title={t('library.title')}
      description={t('library.description')}
      meta={library.data ? String(sounds.length + mixes.length) : undefined}
      search={{ value: query, onChange: setQuery }}
      filters={<CategoryFilter value={categoryIds} onChange={setCategoryIds} />}
      bar={<Pagination pages={pages} toTop pinned />}
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
          <div className="flex max-w-[1040px] flex-col gap-4 pb-16 lg:pb-0">
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
                  {soundPages.shown.map((sound) => (
                    <SoundRow
                      key={sound.id}
                      sound={sound}
                      removing={sound.id === removingSound?.id}
                      busy={soundsEntry.isPending}
                      onAdd={() => soundsEntry.mutate({ id: sound.id, add: true })}
                      onRemove={() => {
                        const usage = soundUsage(sound.id, board);
                        // Used somewhere on the board, or stuck inside a borrowed mix: say
                        // so before it goes. Otherwise there is nothing to warn about.
                        const used =
                          usage.mixes.length +
                            usage.scenes.length +
                            usage.scenesViaMix.length +
                            usage.blockingMixes.length >
                          0;
                        if (used) setRemovingSound(sound);
                        else soundsEntry.mutate({ id: sound.id, add: false });
                      }}
                    />
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
                {mixPages.shown.map((mix) => (
                  <MixRow
                    key={mix.id}
                    mix={mix}
                    byId={byId}
                    onAdd={() => setAdding(mix)}
                    onRemove={() => setRemoving(mix)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </QueryGate>

      {adding && (
        <AddMixDialog mix={adding} byId={byId} heldIds={heldIds} onClose={() => setAdding(null)} />
      )}
      {removing && (
        <RemoveMixDialog
          mix={removing}
          byId={byId}
          heldIds={heldIds}
          fate={removableWith(removing, {
            own: own.data ?? [],
            ownMixes: ownMixes.data ?? [],
            scenes: ownScenes.data ?? [],
            libraryMixes: library.data?.mixes ?? [],
            addedSoundIds: new Set(
              (library.data?.sounds ?? []).filter((s) => s.access === 'added').map((s) => s.id),
            ),
          })}
          onClose={() => setRemoving(null)}
        />
      )}
      {removingSound && (
        <RemoveSoundDialog
          sound={removingSound}
          usage={soundUsage(removingSound.id, board)}
          onClose={() => setRemovingSound(null)}
        />
      )}
    </Page>
  );
}

/**
 * What happens to the sounds of `mix` when it leaves the library.
 * - `removable`: added rather than owned, and used by no other mix or scene of theirs. They
 *   may go with it.
 * - `used`: added rather than owned, but another mix or scene of theirs still uses them.
 *   They stay, because removing them would break something the user kept.
 * The mix itself never counts as a use: it is the thing leaving.
 */
function removableWith(
  mix: Mix,
  board: {
    own: Sound[];
    ownMixes: Mix[];
    scenes: { soundIds: string[]; mixIds: string[] }[];
    libraryMixes: Mix[];
    addedSoundIds: Set<string>;
  },
): { removable: Set<string>; used: Set<string> } {
  const ownIds = new Set(board.own.map((s) => s.id));
  const usedElsewhere = new Set<string>();
  // Only the mixes the user actually holds protect a sound: a public mix of somebody else
  // that happens to use the same sound says nothing about what this user would lose.
  const heldMixes = [
    ...board.ownMixes,
    ...board.libraryMixes.filter((other) => other.access !== 'available'),
  ];
  for (const other of heldMixes) {
    if (other.id === mix.id) continue;
    for (const item of other.items) usedElsewhere.add(item.soundId);
  }
  // A scene holding another mix of theirs holds its sounds too.
  const keptMixIds = new Set<string>();
  for (const scene of board.scenes) for (const id of scene.mixIds) keptMixIds.add(id);
  for (const other of heldMixes) {
    if (other.id === mix.id || !keptMixIds.has(other.id)) continue;
    for (const item of other.items) usedElsewhere.add(item.soundId);
  }
  for (const scene of board.scenes) for (const id of scene.soundIds) usedElsewhere.add(id);

  const added = mix.items
    .map((item) => item.soundId)
    .filter((id) => board.addedSoundIds.has(id) && !ownIds.has(id));
  return {
    removable: new Set(added.filter((id) => !usedElsewhere.has(id))),
    used: new Set(added.filter((id) => usedElsewhere.has(id))),
  };
}

function SoundRow({
  sound,
  removing,
  busy,
  onAdd,
  onRemove,
}: {
  sound: Sound;
  /** Its removal dialog is open. */
  removing: boolean;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const ModeIcon = MODE_ICONS[sound.defaultMode];
  return (
    <Row
      name={sound.name}
      illustration={sound.illustration}
      fallback={FALLBACK_ICONS.sound}
      what={
        <span className="flex min-w-0 items-center gap-1.5">
          <ModeIcon size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">
            {t(MODE_LABELS[sound.defaultMode])}
            <span className="ml-3 tabular-nums">{duration(sound.durationSec)}</span>
          </span>
        </span>
      }
      owner={sound.ownerName}
      description={sound.description}
      license={sound.license}
      playing={player.isSoundPlaying(sound.id)}
      onPlay={() => player.toggleSound(sound)}
      action={
        <ActionButton
          name={sound.name}
          access={sound.access}
          busy={busy}
          active={removing}
          onAdd={onAdd}
          onRemove={sound.access === 'added' ? onRemove : undefined}
        />
      }
    />
  );
}

/** How many of a mix's sounds are drawn beside its name. */
const MIX_THUMBS = 4;

function MixRow({
  mix,
  byId,
  onAdd,
  onRemove,
}: {
  mix: Mix;
  byId: Map<string, Sound>;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const { tn } = useI18n();
  const player = usePlayer();
  const inside = mix.items.slice(0, MIX_THUMBS).map((item) => byId.get(item.soundId));
  const extra = mix.items.length - inside.length;
  return (
    <Row
      name={mix.name}
      illustration={mix.illustration}
      fallback={FALLBACK_ICONS.mix}
      what={
        <>
          {/* The sounds it is made of, as a small overlapping stack of their pictures. */}
          {inside.length > 0 && (
            <span className="flex shrink-0 items-center" aria-hidden>
              {inside.map((sound, i) => (
                <Thumb
                  key={mix.items[i]!.id}
                  value={sound?.illustration ?? { type: 'none' }}
                  fallback={FALLBACK_ICONS.sound}
                  size="size-5"
                  radius="rounded-[5px]"
                  iconSize="size-3"
                  className="-ml-1 ring-1 ring-card first:ml-0"
                />
              ))}
              {/* The count under the name already says how many there are in all. */}
              {extra > 0 && (
                <span className="-ml-1 flex size-5 items-center justify-center rounded-[5px] border border-line bg-raised font-mono text-[10px] leading-none text-ink-3 ring-1 ring-card">
                  +{extra}
                </span>
              )}
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
        <ActionButton
          name={mix.name}
          access={mix.access}
          busy={false}
          onAdd={onAdd}
          onRemove={mix.access === 'added' ? onRemove : undefined}
        />
      }
    />
  );
}

/**
 * One shared item: a picture, its name over what it is, and a right-hand group holding the
 * license, who shared it, and the two buttons.
 *
 * Three zones, not a grid of columns. Fixed columns for the owner and the license ate the
 * name's width on a tablet and left the owner stranded in the middle of the row; the group
 * is sized by its own content and sticks to the right edge, so the name keeps everything
 * that is left. On phones the group drops to a band of its own under the text.
 */
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
  /** Who shared it, shown with their initials. */
  owner: string;
  description: string | null;
  license?: string | null;
  playing: boolean;
  onPlay: () => void;
  /** Add, remove, or the greyed state of an item that needs no action. */
  action: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3 first:border-t-0 md:flex-nowrap md:gap-x-4 md:py-3">
      <Thumb
        value={illustration}
        fallback={fallback}
        lit={playing}
        size="size-12 md:size-14"
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <Lamp on={playing} />
          <span className="truncate text-[15px] leading-6 font-medium">{name}</span>
        </span>
        <span className="flex h-5 min-w-0 items-center gap-3 pl-4 text-[13px] leading-5 text-ink-3">
          {what}
          {license && <LicenseBadge value={license} />}
        </span>
        {description && (
          <p className="mt-1 line-clamp-2 pl-4 text-[14px] leading-5 text-ink-2 md:line-clamp-1">
            {description}
          </p>
        )}
      </div>
      <div className="flex w-full items-center gap-3 md:w-auto md:shrink-0">
        <OwnerBadge owner={owner} />

        <span className="ml-auto flex shrink-0 items-center gap-2 md:ml-0">
          <IconButton
            icon={playing ? Square : Play}
            label={t(playing ? 'library.stop' : 'library.play', { name })}
            aria-pressed={playing}
            onClick={onPlay}
            variant="secondary"
            className={playing ? 'text-lamp hover:text-lamp' : undefined}
          />
          {action}
        </span>
      </div>
    </li>
  );
}

/**
 * The one thing you can do with this item, always the same 44px box, so Play holds one
 * line down the whole list. What you can do depends on the state: add it, take it back out
 * if it is already yours to use, or nothing at all when you own it, which shows the button
 * greyed out rather than hiding the slot.
 */
function ActionButton({
  name,
  access,
  busy,
  active = false,
  onAdd,
  onRemove,
}: {
  name: string;
  access: Sound['access'];
  busy: boolean;
  /** This item's own dialog is open, so the button reads as held down. */
  active?: boolean;
  onAdd: () => void;
  /** Only a mix needs a dialog before it comes out; a sound removes at once. */
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  if (access === 'owner') {
    return (
      <Button
        variant="secondary"
        icon={Plus}
        disabled
        aria-label={t('library.yoursItem', { name })}
        title={t('library.yoursItem', { name })}
        className="size-11 shrink-0 px-0"
      />
    );
  }
  if (access === 'added' && onRemove) {
    return (
      <Button
        variant="secondary"
        icon={Trash2}
        disabled={busy}
        onClick={onRemove}
        aria-label={t('library.removeItem', { name })}
        title={t('library.removeItem', { name })}
        aria-expanded={active}
        className={cx(
          'size-11 shrink-0 px-0 text-ink-2 hover:text-danger',
          active && 'bg-raised-hover text-danger',
        )}
      />
    );
  }
  // An added item with nothing wired to take it back out: the state, said honestly.
  if (access === 'added') {
    return (
      <Button
        variant="secondary"
        icon={Check}
        disabled
        aria-label={t('library.addedItem', { name })}
        title={t('library.addedItem', { name })}
        className="size-11 shrink-0 px-0"
      />
    );
  }
  return (
    <Button
      variant="secondary"
      icon={Plus}
      busy={busy}
      disabled={busy}
      onClick={onAdd}
      aria-label={t('library.addItem', { name })}
      title={t('library.addItem', { name })}
      className="size-11 shrink-0 px-0"
    />
  );
}

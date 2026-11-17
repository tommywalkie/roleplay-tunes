import type { Illustration, Mix, Sound } from '@dnd/shared';
import { Check, Play, Plus, Square, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLibrary, useLibraryEntry } from '../api/hooks';
import { usePlayer } from '../audio/player';
import { Thumb } from '../components/Illustration';
import { FALLBACK_ICONS, MODE_LABELS } from '../components/kinds';
import { matches, NoMatch, Page, QueryGate } from '../components/Page';
import { Button, EmptyState, IconButton, Lamp, Segmented } from '../components/ui';
import { useI18n } from '../i18n';

type Tab = 'sounds' | 'mixes';

/** Every public sound and mix: listen first, then add what you like to your own library. */
export function LibraryPage() {
  const { t, tn } = useI18n();
  const library = useLibrary();
  const [tab, setTab] = useState<Tab>('sounds');
  const [query, setQuery] = useState('');

  const sounds = library.data?.sounds ?? [];
  const mixes = library.data?.mixes ?? [];
  const searchable = (item: Sound | Mix) =>
    `${item.name} ${item.ownerName} ${item.description ?? ''}`;
  const shownSounds = sounds.filter((s) => matches(searchable(s), query));
  const shownMixes = mixes.filter((m) => matches(searchable(m), query));
  const empty = sounds.length + mixes.length === 0;

  return (
    <Page
      title={t('library.title')}
      description={t('library.description')}
      meta={library.data ? String(sounds.length + mixes.length) : undefined}
      search={{ value: query, onChange: setQuery }}
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
                  <MixRow key={mix.id} mix={mix} />
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
  return (
    <Row
      name={sound.name}
      illustration={sound.illustration}
      fallback={FALLBACK_ICONS.sound}
      meta={`${t('library.by', { name: sound.ownerName })} · ${t(MODE_LABELS[sound.defaultMode])} · ${duration(sound.durationSec)}`}
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

function MixRow({ mix }: { mix: Mix }) {
  const { t, tn } = useI18n();
  const player = usePlayer();
  const entry = useLibraryEntry('mixes');
  return (
    <Row
      name={mix.name}
      illustration={mix.illustration}
      fallback={FALLBACK_ICONS.mix}
      meta={`${t('library.by', { name: mix.ownerName })} · ${tn('count.sounds', mix.items.length)}`}
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
  meta,
  description,
  license,
  playing,
  onPlay,
  action,
}: {
  name: string;
  illustration: Illustration;
  fallback: LucideIcon;
  meta: string;
  description: string | null;
  license?: string | null;
  playing: boolean;
  onPlay: () => void;
  action: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <li className="flex items-start gap-4 border-t border-line px-4 py-4 first:border-t-0 md:px-5">
      <Thumb value={illustration} fallback={fallback} lit={playing} className="size-14 rounded-[10px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <Lamp on={playing} />
          <span className="truncate text-[15px] leading-6 font-medium">{name}</span>
        </span>
        <span className="truncate pl-4 text-[13px] leading-5 text-ink-3 tabular-nums">{meta}</span>
        {description && (
          <p className="line-clamp-2 pl-4 text-[14px] leading-5 text-ink-2">{description}</p>
        )}
        {license && (
          <p className="truncate pl-4 text-[13px] leading-5 text-ink-3">
            {t('library.license', { license })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <IconButton
          icon={playing ? Square : Play}
          label={t(playing ? 'library.stop' : 'library.play', { name })}
          aria-pressed={playing}
          onClick={onPlay}
          className={playing ? 'text-lamp hover:text-lamp' : undefined}
        />
        {action}
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
  if (access === 'owner') {
    return <span className="w-24 text-center text-[13px] leading-5 text-ink-3">{t('library.yours')}</span>;
  }
  if (access === 'added') {
    return (
      <Button variant="ghost" icon={Check} disabled className="w-24 px-3">
        {t('library.added')}
      </Button>
    );
  }
  return (
    <Button
      icon={Plus}
      busy={busy}
      onClick={onAdd}
      aria-label={t('library.addItem', { name })}
      className="w-24 px-3"
    >
      {t('library.add')}
    </Button>
  );
}

import type { Me } from '@dnd/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMixes, useScenes, useSounds } from '../api/hooks';
import { MixTile, SoundTile } from '../board/tiles';
import { FALLBACK_ICONS } from '../components/kinds';
import { LibraryButton, matches, NoMatch, Page, QueryGate, searchText } from '../components/Page';
import { sorted, type Sort } from '../components/Sort';
import { TileGrid } from '../components/Tile';
import { Button, EmptyState } from '../components/ui';
import { MixEditor } from '../editors/MixEditor';
import { SceneEditor } from '../editors/SceneEditor';
import { SoundEditor } from '../editors/SoundEditor';
import { useI18n } from '../i18n';

type Editing = { kind: 'scene' } | { kind: 'mix' | 'sound'; id: string } | null;

/** One scene: its mixes and its sounds, ready to play. */
export function ScenePage({ me }: { me: Me }) {
  const { t, tn } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const scenes = useScenes();
  const sounds = useSounds();
  const mixes = useMixes();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('name-asc');
  const [editing, setEditing] = useState<Editing>(null);

  const scene = scenes.data?.find((s) => s.id === id);
  const allSounds = sounds.data ?? [];
  const allMixes = mixes.data ?? [];
  // The scene's own order, minus anything deleted since.
  const sceneMixes = (scene?.mixIds ?? []).flatMap((x) => allMixes.find((m) => m.id === x) ?? []);
  const sceneSounds = (scene?.soundIds ?? []).flatMap((x) => allSounds.find((s) => s.id === x) ?? []);
  const shownMixes = sceneMixes.filter((m) => matches(searchText(m), query));
  const shownSounds = sceneSounds.filter((s) => matches(searchText(s), query));
  const empty = sceneMixes.length + sceneSounds.length === 0;
  // One board, not two lists: mixes and sounds are ordered together, which is why a mix
  // tile carries the mix icon and its word.
  const shown = sorted(
    [
      ...shownMixes.map((mix) => ({ name: mix.name, createdAt: mix.createdAt, mix })),
      ...shownSounds.map((sound) => ({ name: sound.name, createdAt: sound.createdAt, sound })),
    ],
    sort,
  );

  const editedMix = editing?.kind === 'mix' ? allMixes.find((m) => m.id === editing.id) : undefined;
  const editedSound =
    editing?.kind === 'sound' ? allSounds.find((s) => s.id === editing.id) : undefined;
  const close = () => setEditing(null);
  const loading = scenes.isLoading || sounds.isLoading || mixes.isLoading;

  return (
    <Page
      title={scene?.name ?? t('scenes.title')}
      longTitle
      backTo="/scenes"
      action={
        scene && (
          <Button icon={Pencil} onClick={() => setEditing({ kind: 'scene' })}>
            {t('common.edit')}
          </Button>
        )
      }
      search={scene && !empty ? { value: query, onChange: setQuery } : undefined}
      sort={scene && !empty ? { value: sort, onChange: setSort } : undefined}
    >
      <QueryGate
        loading={loading}
        error={scenes.error ?? sounds.error ?? mixes.error}
        onRetry={() => void Promise.all([scenes.refetch(), sounds.refetch(), mixes.refetch()])}
      >
        {!scene ? (
          <EmptyState icon={FALLBACK_ICONS.scene} title={t('scenes.notFound')} />
        ) : empty ? (
          <EmptyState
            icon={FALLBACK_ICONS.scene}
            title={t('scenes.contentEmpty.title')}
            body={t('scenes.contentEmpty.body')}
            action={
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" icon={Plus} onClick={() => setEditing({ kind: 'scene' })}>
                  {t('scenes.addContent')}
                </Button>
                <LibraryButton />
              </div>
            }
          />
        ) : shownMixes.length + shownSounds.length === 0 ? (
          <NoMatch query={query.trim()} />
        ) : (
          <TileGrid
            label={`${tn('count.mixes', shownMixes.length)} ${tn('count.sounds', shownSounds.length)}`}
          >
            {shown.map((entry) =>
              'mix' in entry ? (
                <MixTile
                  key={`mix:${entry.mix.id}`}
                  mix={entry.mix}
                  onEdit={() => setEditing({ kind: 'mix', id: entry.mix.id })}
                />
              ) : (
                <SoundTile
                  key={`sound:${entry.sound.id}`}
                  sound={entry.sound}
                  onEdit={() => setEditing({ kind: 'sound', id: entry.sound.id })}
                />
              ),
            )}
          </TileGrid>
        )}
      </QueryGate>

      {scene && editing?.kind === 'scene' && (
        <SceneEditor
          scene={scene}
          sounds={allSounds}
          mixes={allMixes}
          me={me}
          onClose={close}
          onDeleted={() => void navigate('/scenes', { replace: true })}
        />
      )}
      {editedMix && (
        <MixEditor
          mix={editedMix}
          mixes={mixes.data}
          sounds={allSounds}
          scenes={scenes.data ?? []}
          me={me}
          onClose={close}
        />
      )}
      {editedSound && (
        <SoundEditor
          sound={editedSound}
          scenes={scenes.data ?? []}
          mixes={mixes.data}
          me={me}
          onClose={close}
        />
      )}
    </Page>
  );
}

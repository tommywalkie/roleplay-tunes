import type { Me } from '@dnd/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMixes, useScenes, useSounds } from '../api/hooks';
import { MixTile, SoundTile } from '../board/tiles';
import { FALLBACK_ICONS } from '../components/kinds';
import { matches, NoMatch, Page, QueryGate, searchText } from '../components/Page';
import { TileGrid } from '../components/Tile';
import { Button, EmptyState } from '../components/ui';
import { MixEditor } from '../editors/MixEditor';
import { SceneEditor } from '../editors/SceneEditor';
import { SoundEditor } from '../editors/SoundEditor';
import { useI18n } from '../i18n';

type Editing = { kind: 'scene' } | { kind: 'mix' | 'sound'; id: string } | null;

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-baseline gap-2 text-[15px] leading-5 text-ink-2">
        {title}
        <span className="font-mono text-[12px] text-ink-3 tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** One scene: its mixes and its sounds, ready to play. */
export function ScenePage({ me }: { me: Me }) {
  const { t, tn } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const scenes = useScenes();
  const sounds = useSounds();
  const mixes = useMixes();
  const [query, setQuery] = useState('');
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

  const editedMix = editing?.kind === 'mix' ? allMixes.find((m) => m.id === editing.id) : undefined;
  const editedSound =
    editing?.kind === 'sound' ? allSounds.find((s) => s.id === editing.id) : undefined;
  const close = () => setEditing(null);
  const loading = scenes.isLoading || sounds.isLoading || mixes.isLoading;

  return (
    <Page
      title={scene?.name ?? t('scenes.title')}
      backTo="/scenes"
      action={
        scene && (
          <Button icon={Pencil} onClick={() => setEditing({ kind: 'scene' })}>
            {t('common.edit')}
          </Button>
        )
      }
      search={scene && !empty ? { value: query, onChange: setQuery } : undefined}
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
              <Button variant="primary" icon={Plus} onClick={() => setEditing({ kind: 'scene' })}>
                {t('scenes.addContent')}
              </Button>
            }
          />
        ) : shownMixes.length + shownSounds.length === 0 ? (
          <NoMatch query={query.trim()} />
        ) : (
          <div className="flex flex-col gap-8">
            {shownMixes.length > 0 && (
              <Section title={t('nav.mixes')} count={shownMixes.length}>
                <TileGrid label={tn('count.mixes', shownMixes.length)}>
                  {shownMixes.map((mix) => (
                    <MixTile
                      key={mix.id}
                      mix={mix}
                      onEdit={() => setEditing({ kind: 'mix', id: mix.id })}
                    />
                  ))}
                </TileGrid>
              </Section>
            )}
            {shownSounds.length > 0 && (
              <Section title={t('nav.sounds')} count={shownSounds.length}>
                <TileGrid label={tn('count.sounds', shownSounds.length)}>
                  {shownSounds.map((sound) => (
                    <SoundTile
                      key={sound.id}
                      sound={sound}
                      onEdit={() => setEditing({ kind: 'sound', id: sound.id })}
                    />
                  ))}
                </TileGrid>
              </Section>
            )}
          </div>
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
        <MixEditor mix={editedMix} sounds={allSounds} scenes={scenes.data ?? []} me={me} onClose={close} />
      )}
      {editedSound && (
        <SoundEditor sound={editedSound} scenes={scenes.data ?? []} me={me} onClose={close} />
      )}
    </Page>
  );
}

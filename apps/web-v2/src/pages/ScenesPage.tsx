import type { Me } from '@dnd/shared';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMixes, useScenes, useSounds } from '../api/hooks';
import { SceneTile } from '../board/tiles';
import { FALLBACK_ICONS } from '../components/kinds';
import { CategoryFilter, inCategories } from '../components/Categories';
import {
  gridPageSize,
  matches,
  NoMatch,
  Page,
  Pagination,
  QueryGate,
  searchText,
  useGridColumns,
  usePages,
} from '../components/Page';
import { TileGrid } from '../components/Tile';
import { sorted, type Sort } from '../components/Sort';
import { Button, EmptyState } from '../components/ui';
import { SceneEditor } from '../editors/SceneEditor';
import { useI18n } from '../i18n';

export function ScenesPage({ me }: { me: Me }) {
  const { t, tn } = useI18n();
  const scenes = useScenes();
  const sounds = useSounds();
  const mixes = useMixes();
  const [query, setQuery] = useState('');
  /** A scene id, `'new'` for a scene being created, or nothing. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('name-asc');

  const all = scenes.data ?? [];
  const found = all.filter((s) => matches(searchText(s), query) && inCategories(s, categoryIds));
  const grid = useRef<HTMLUListElement>(null);
  const columns = useGridColumns(grid);
  const pages = usePages(
    sorted(found, sort),
    `${query}\n${categoryIds.join()}\n${sort}`,
    gridPageSize(columns),
  );
  const editing = all.find((s) => s.id === editingId);

  return (
    <Page
      title={t('scenes.title')}
      description={t('scenes.description')}
      meta={scenes.data ? String(all.length) : undefined}
      action={
        <Button variant="primary" icon={Plus} onClick={() => setEditingId('new')}>
          {t('scenes.new')}
        </Button>
      }
      search={{ value: query, onChange: setQuery }}
      filters={<CategoryFilter value={categoryIds} onChange={setCategoryIds} />}
      sort={{ value: sort, onChange: setSort }}
      bar={<Pagination pages={pages} toTop pinned />}
    >
      <QueryGate loading={scenes.isLoading} error={scenes.error} onRetry={() => void scenes.refetch()}>
        {all.length === 0 ? (
          <EmptyState
            icon={FALLBACK_ICONS.scene}
            title={t('scenes.empty.title')}
            body={t('scenes.empty.body')}
          />
        ) : found.length === 0 ? (
          <NoMatch query={query.trim()} />
        ) : (
          <div className="pb-16 lg:pb-0">
            <TileGrid ref={grid} label={tn('count.scenes', found.length)}>
              {pages.shown.map((scene) => (
                <SceneTile key={scene.id} scene={scene} onEdit={() => setEditingId(scene.id)} />
              ))}
            </TileGrid>
          </div>
        )}
      </QueryGate>

      {(editing || editingId === 'new') && (
        <SceneEditor
          scene={editing ?? null}
          sounds={sounds.data ?? []}
          mixes={mixes.data ?? []}
          me={me}
          onClose={() => setEditingId(null)}
        />
      )}
    </Page>
  );
}

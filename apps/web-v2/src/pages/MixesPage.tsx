import type { Me } from '@dnd/shared';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMixes, useScenes, useSounds } from '../api/hooks';
import { MixTile } from '../board/tiles';
import { FALLBACK_ICONS, KIND_ICONS } from '../components/kinds';
import { CategoryFilter, inCategories } from '../components/Categories';
import {
  gridPageSize,
  LibraryButton,
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
import { MixEditor } from '../editors/MixEditor';
import { useI18n } from '../i18n';

export function MixesPage({ me }: { me: Me }) {
  const { t, tn } = useI18n();
  const mixes = useMixes();
  const sounds = useSounds();
  const scenes = useScenes();
  const [query, setQuery] = useState('');
  /** A mix id, `'new'` / `'new-playlist'` for one being created, or nothing. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const creating = editingId === 'new' || editingId === 'new-playlist';
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('name-asc');

  const all = mixes.data ?? [];
  const found = all.filter((m) => matches(searchText(m), query) && inCategories(m, categoryIds));
  const grid = useRef<HTMLUListElement>(null);
  const columns = useGridColumns(grid);
  const pages = usePages(
    sorted(found, sort),
    `${query}\n${categoryIds.join()}\n${sort}`,
    gridPageSize(columns),
  );
  const editing = all.find((m) => m.id === editingId);

  return (
    <Page
      title={t('mixes.title')}
      description={t('mixes.description')}
      meta={mixes.data ? String(all.length) : undefined}
      action={
        <div className="flex flex-wrap gap-2">
          <Button icon={KIND_ICONS.playlist} onClick={() => setEditingId('new-playlist')}>
            {t('mixes.newPlaylist')}
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => setEditingId('new')}>
            {t('mixes.new')}
          </Button>
        </div>
      }
      search={{ value: query, onChange: setQuery }}
      filters={<CategoryFilter value={categoryIds} onChange={setCategoryIds} />}
      sort={{ value: sort, onChange: setSort }}
      bar={<Pagination pages={pages} toTop pinned />}
    >
      <QueryGate loading={mixes.isLoading} error={mixes.error} onRetry={() => void mixes.refetch()}>
        {all.length === 0 ? (
          <EmptyState
            icon={FALLBACK_ICONS.mix}
            title={t('mixes.empty.title')}
            body={t('mixes.empty.body')}
            action={<LibraryButton />}
          />
        ) : found.length === 0 ? (
          <NoMatch query={query.trim()} />
        ) : (
          <div className="pb-16 lg:pb-0">
            <TileGrid ref={grid} label={tn('count.mixes', found.length)}>
              {pages.shown.map((mix) => (
                <MixTile key={mix.id} mix={mix} onEdit={() => setEditingId(mix.id)} />
              ))}
            </TileGrid>
          </div>
        )}
      </QueryGate>

      {(editing || creating) && (
        <MixEditor
          mix={editing ?? null}
          kind={editingId === 'new-playlist' ? 'playlist' : undefined}
          mixes={all}
          sounds={sounds.data ?? []}
          scenes={scenes.data ?? []}
          me={me}
          onClose={() => setEditingId(null)}
        />
      )}
    </Page>
  );
}

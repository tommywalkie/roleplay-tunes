import type { Me } from '@dnd/shared';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useScenes, useSounds } from '../api/hooks';
import { SoundTile } from '../board/tiles';
import { FALLBACK_ICONS } from '../components/kinds';
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
import { SoundEditor } from '../editors/SoundEditor';
import { UploadDialog } from '../editors/UploadDialog';
import { useI18n } from '../i18n';

export function SoundsPage({ me }: { me: Me }) {
  const { t, tn } = useI18n();
  const sounds = useSounds();
  const scenes = useScenes();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('name-asc');

  const all = sounds.data ?? [];
  const found = all.filter((s) => matches(searchText(s), query) && inCategories(s, categoryIds));
  const grid = useRef<HTMLUListElement>(null);
  const columns = useGridColumns(grid);
  const pages = usePages(
    sorted(found, sort),
    `${query}\n${categoryIds.join()}\n${sort}`,
    gridPageSize(columns),
  );
  const editing = all.find((s) => s.id === editingId);
  const uploadButton = (
    <Button variant="primary" icon={Upload} onClick={() => setUploading(true)}>
      {t('sounds.upload')}
    </Button>
  );

  return (
    <Page
      title={t('sounds.title')}
      description={t('sounds.description')}
      meta={sounds.data ? String(all.length) : undefined}
      action={uploadButton}
      search={{ value: query, onChange: setQuery }}
      filters={<CategoryFilter value={categoryIds} onChange={setCategoryIds} />}
      sort={{ value: sort, onChange: setSort }}
      bar={<Pagination pages={pages} toTop pinned />}
    >
      <QueryGate loading={sounds.isLoading} error={sounds.error} onRetry={() => void sounds.refetch()}>
        {all.length === 0 ? (
          <EmptyState
            icon={FALLBACK_ICONS.sound}
            title={t('sounds.empty.title')}
            body={t('sounds.empty.body')}
            action={<LibraryButton />}
          />
        ) : found.length === 0 ? (
          <NoMatch query={query.trim()} />
        ) : (
          <div className="pb-16 lg:pb-0">
            <TileGrid ref={grid} label={tn('count.sounds', found.length)}>
              {pages.shown.map((sound) => (
                <SoundTile key={sound.id} sound={sound} onEdit={() => setEditingId(sound.id)} />
              ))}
            </TileGrid>
          </div>
        )}
      </QueryGate>

      {editing && (
        <SoundEditor
          sound={editing}
          scenes={scenes.data ?? []}
          me={me}
          onClose={() => setEditingId(null)}
        />
      )}
      {uploading && <UploadDialog me={me} onClose={() => setUploading(false)} />}
    </Page>
  );
}

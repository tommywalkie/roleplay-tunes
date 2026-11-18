import type { Category } from '@dnd/shared';
import { ChevronRight, Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { useCategories } from '../api/hooks';
import { CategoryChip, CategoryDialog } from '../components/Categories';
import { Page, QueryGate } from '../components/Page';
import { Button, EmptyState, Icon } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * The user's own categories. What a category sorts is decided on the items themselves, so
 * this page only manages the labels: creating, changing and deleting one each open a dialog
 * over the list. Deleting takes it off every item that carries it; the items stay.
 */
export function CategoriesPage() {
  const { t, tn } = useI18n();
  const categories = useCategories();
  // null: no dialog. { category: null }: creating. Otherwise: editing that one.
  const [editing, setEditing] = useState<{ category: Category | null } | null>(null);
  const list = categories.data ?? [];

  return (
    <Page
      title={t('categories.label')}
      meta={categories.data ? String(list.length) : undefined}
      description={t('categories.page.description')}
      backTo="/profile"
      action={
        <Button variant="primary" icon={Plus} onClick={() => setEditing({ category: null })}>
          {t('categories.new')}
        </Button>
      }
    >
      <QueryGate
        loading={categories.isLoading}
        error={categories.error}
        onRetry={() => void categories.refetch()}
      >
        {list.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={t('categories.page.empty.title')}
            body={t('categories.page.empty.body')}
          />
        ) : (
          <ul
            aria-label={tn('count.categories', list.length)}
            className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-card"
          >
            {list.map((category) => (
              <li key={category.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  onClick={() => setEditing({ category })}
                  title={t('categories.editItem', { name: category.name })}
                  aria-label={t('categories.editItem', { name: category.name })}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-raised/60 md:px-6"
                >
                  <CategoryChip category={category} />
                  <Icon icon={ChevronRight} className="ml-auto shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </QueryGate>

      {editing && <CategoryDialog category={editing.category} onClose={() => setEditing(null)} />}
    </Page>
  );
}

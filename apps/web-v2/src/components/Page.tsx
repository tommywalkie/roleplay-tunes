import { ArrowLeft, ChevronLeft, ChevronRight, LibraryBig, SearchX } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { Button, cx, EmptyState, ErrorNote, Icon, IconButton, SearchField, Spinner } from './ui';

/**
 * Frame shared by every page: a title row whose action never moves, an optional search
 * field under it that stays at the top while the list scrolls, then the content.
 */
export function Page({
  title,
  meta,
  description,
  action,
  backTo,
  search,
  filters,
  children,
}: {
  title: string;
  /** Quiet count next to the title. */
  meta?: string;
  /** One line under the title on what the page holds. */
  description?: string;
  action?: ReactNode;
  backTo?: string;
  search?: { value: string; onChange: (value: string) => void };
  /** Shown under the search field, and stays on screen with it. */
  filters?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex w-full max-w-[1280px] animate-enter flex-col gap-6 px-4 pb-10 pt-6 md:px-8 md:pt-8">
      <header className="flex flex-col gap-4">
        <div className="flex min-h-11 items-center gap-3">
          {backTo && (
            <Link
              to={backTo}
              aria-label={t('common.back')}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
            >
              <Icon icon={ArrowLeft} />
            </Link>
          )}
          <h1 className="min-w-0 truncate text-[28px] leading-8 font-medium">{title}</h1>
          {meta && (
            <span className="shrink-0 pt-1.5 font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
              {meta}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>
        </div>
        {description && (
          <p className="-mt-2 max-w-[60ch] text-[14px] leading-5 text-ink-2">{description}</p>
        )}
      </header>
      {search && (
        // A child of the whole page, not of the header, so it stays at the top of the
        // scrolling area while the list moves under it. The band covers the list edge to edge.
        <div className="sticky top-0 z-10 -mx-4 -my-3 flex flex-col gap-3 bg-page px-4 py-3 md:-mx-8 md:px-8">
          <SearchField
            value={search.value}
            onChange={search.onChange}
            label={t('common.search')}
            className="md:max-w-[360px]"
          />
          {filters}
        </div>
      )}
      {children}
    </div>
  );
}

/** Loading, failure, then content: one behavior for every list. */
export function QueryGate({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  children: ReactNode;
}) {
  const { t, errorText } = useI18n();
  if (loading) return <Spinner label={t('common.loading')} />;
  if (error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ErrorNote>
          {t('common.loadFailed')}: {errorText(error)}
        </ErrorNote>
        <Button onClick={onRetry}>{t('common.retry')}</Button>
      </div>
    );
  }
  return <>{children}</>;
}

/** How many items one page of a list shows. */
export const PAGE_SIZE = 30;

/**
 * One page of `items` at a time. Back to the first page whenever `resetKey` changes (a new
 * search, other categories, another tab), and never past the last page when the list
 * shrinks under the reader.
 */
export function usePages<T>(items: T[], resetKey: string, size = PAGE_SIZE) {
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(state.key === resetKey ? state.page : 0, pageCount - 1);
  const setPage = useCallback((next: number) => setState({ key: resetKey, page: next }), [resetKey]);
  return { page, pageCount, setPage, shown: items.slice(page * size, (page + 1) * size) };
}

/**
 * Previous and next around "page n of m", under the list it pages. Renders nothing for a
 * list that fits on one page. With `toTop`, a new page starts the page's scroll over, so
 * the reader lands on its first item rather than at the foot where they clicked.
 */
export function Pagination({
  pages: { page, pageCount, setPage },
  toTop = false,
  className,
}: {
  pages: ReturnType<typeof usePages>;
  toTop?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  if (pageCount <= 1) return null;
  const onChange = (next: number) => {
    setPage(next);
    if (toTop) document.querySelector('main')?.scrollTo({ top: 0 });
  };
  return (
    <nav aria-label={t('pages.label')} className={cx('flex items-center gap-1', className)}>
      <IconButton
        icon={ChevronLeft}
        label={t('pages.previous')}
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        className="disabled:opacity-40"
      />
      <span className="min-w-[88px] text-center text-[13px] leading-5 text-ink-2 tabular-nums">
        {t('pages.current', { page: page + 1, count: pageCount })}
      </span>
      <IconButton
        icon={ChevronRight}
        label={t('pages.next')}
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        className="disabled:opacity-40"
      />
    </nav>
  );
}

/** For an empty list of sounds or mixes: other people's public ones wait in the Library. */
export function LibraryButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Button icon={LibraryBig} onClick={() => void navigate('/library')}>
      {t('library.browse')}
    </Button>
  );
}

export function NoMatch({ query }: { query: string }) {
  const { t } = useI18n();
  return <EmptyState icon={SearchX} title={t('common.noMatch', { query })} />;
}

/** What search looks through on an item: its name and the synonyms the user sees on it. */
export function searchText(item: { name: string; synonyms?: { label: string }[] }): string {
  return [item.name, ...(item.synonyms ?? []).map((s) => s.label)].join('\n');
}

/** Case- and accent-insensitive "contains", so `foret` finds `Forêt`. */
export function matches(name: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  return norm(name).includes(norm(query.trim()));
}

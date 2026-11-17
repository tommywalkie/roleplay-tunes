import { ArrowLeft, SearchX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { Button, EmptyState, ErrorNote, Icon, SearchField, Spinner } from './ui';

/**
 * Frame shared by every page: a title row whose action never moves, an optional search
 * field under it, then the content.
 */
export function Page({
  title,
  meta,
  action,
  backTo,
  search,
  children,
}: {
  title: string;
  /** Quiet count next to the title. */
  meta?: string;
  action?: ReactNode;
  backTo?: string;
  search?: { value: string; onChange: (value: string) => void };
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
        {search && (
          <SearchField
            value={search.value}
            onChange={search.onChange}
            label={t('common.search')}
            className="md:max-w-[360px]"
          />
        )}
      </header>
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

export function NoMatch({ query }: { query: string }) {
  const { t } = useI18n();
  return <EmptyState icon={SearchX} title={t('common.noMatch', { query })} />;
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

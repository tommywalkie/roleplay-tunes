import { useChangelog, useChangelogSeen } from '../api/hooks';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Button, Spinner } from './ui';

/**
 * What changed, release by release, newest first: one card per version, as a releases
 * page lays them out. Closing it any way at all — the button, the backdrop, Escape —
 * counts as having read it: the server records its newest version as seen.
 */
export function ChangelogDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const notes = useChangelog(locale);
  const seen = useChangelogSeen();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });

  const close = () => {
    seen.mutate();
    onClose();
  };

  return (
    <Dialog
      title={t('changelog.title')}
      onClose={close}
      footer={
        <Button variant="primary" onClick={close} className="ml-auto">
          {t('common.close')}
        </Button>
      }
    >
      {notes.isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : notes.isError || !notes.data ? (
        <p className="text-[14px] leading-5 text-danger">{t('common.loadFailed')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {notes.data.releases.map((release) => (
            <li key={release.version}>
              <article
                aria-labelledby={`release-${release.version}`}
                className="flex flex-col gap-3 rounded-[14px] border border-line bg-deep p-4 sm:p-5"
              >
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2
                    id={`release-${release.version}`}
                    className="font-mono text-[16px] leading-6 font-medium text-ink tabular-nums"
                  >
                    {release.version}
                  </h2>
                  {release.version === notes.data.latest && (
                    <span className="rounded-full border border-line-strong px-2 text-[12px] leading-5 text-ink-2">
                      {t('changelog.latest')}
                    </span>
                  )}
                  {release.date && (
                    <time dateTime={release.date} className="ml-auto text-[13px] leading-5 text-ink-3">
                      {dateFormat.format(new Date(`${release.date}T00:00:00`))}
                    </time>
                  )}
                </header>
                <div
                  className="rich-text"
                  // Sanitized by the server against the same allowlist as the server
                  // rules; see apps/server/src/changelog.ts.
                  dangerouslySetInnerHTML={{ __html: release.html }}
                />
              </article>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}

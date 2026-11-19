import { LogOut } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTerms } from '../api/hooks';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Button, ErrorNote, Spinner } from './ui';

/**
 * What the dialog does with the rules it shows.
 * - `read`: someone asked to see them. Closing is enough.
 * - `accept`: the rules stand between the user and the app. Not closable: it offers
 *   acceptance, or the way out through signing out.
 * - `agree`: the sign-up form asks for them. Its agree button stays greyed, and says why,
 *   until the reader reaches the foot of the text; closing is always offered beside it.
 */
export type TermsMode =
  | { kind: 'read' }
  | { kind: 'agree'; readToEnd: boolean; onAgree: () => void }
  | {
      kind: 'accept';
      onAccept: () => void;
      pending: boolean;
      /** A failed acceptance, worded for the reader. */
      error?: string;
      onSignOut: () => void;
      signingOut: boolean;
    };

/**
 * The server rules: two paragraphs about the app, then the text the administrator wrote
 * for this language. The markup is sanitized on the server before it is stored, so it can
 * only hold the tags the allowlist in `@dnd/shared` permits.
 *
 * `onReadToEnd` reports the reader reaching the foot of the text, once: the sign-up form
 * uses it to unlock its "have read" checkbox.
 */
export function TermsDialog({
  mode,
  updating,
  onClose,
  onReadToEnd,
  preview,
}: {
  mode: TermsMode;
  /** The rules changed since this user accepted them: say so in the title. */
  updating: boolean;
  onClose: () => void;
  onReadToEnd?: () => void;
  /**
   * Shows this text instead of the stored rules, for an admin previewing what they have
   * typed. It has already been through the server's sanitizer, so it renders exactly as
   * it would be stored.
   */
  preview?: { html: string };
}) {
  const { t, locale } = useI18n();
  const terms = useTerms(locale, preview === undefined);
  const sentinel = useRef<HTMLSpanElement>(null);
  const readRef = useRef(onReadToEnd);
  readRef.current = onReadToEnd;

  const html = preview ? preview.html : (terms.data?.html ?? '');
  const loading = preview === undefined && terms.isLoading;
  const title = t(
    preview ? 'terms.preview.title' : updating ? 'terms.updated.title' : 'terms.title',
  );

  // The self-hosting sentence holds the licence name between `{license}`; the link wraps
  // that name, pointing at Apache's own licence page.
  const license = t('terms.intro.license');
  const [beforeLicense, afterLicense] = t('terms.intro.selfhost').split('{license}');
  const licensePage = 'https://www.apache.org/licenses/LICENSE-2.0';

  // One pass of the sentinel is enough: the checkbox stays unlocked for this visit.
  useEffect(() => {
    if (!onReadToEnd || loading || html === '') return;
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          readRef.current?.();
          observer.disconnect();
        }
      },
      // The dialog body is the clipper: with no root, an element scrolled out of it is
      // not intersecting the viewport either.
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onReadToEnd, loading, html]);

  if (terms.isError) {
    return (
      <Dialog
        title={title}
        onClose={onClose}
        dismissible={mode.kind !== 'accept'}
        footer={
          <Button variant="primary" onClick={onClose} className="ml-auto">
            {t('common.close')}
          </Button>
        }
      >
        <p className="text-[14px] leading-5 text-danger">{t('common.loadFailed')}</p>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={title}
      onClose={onClose}
      dismissible={mode.kind !== 'accept'}
      footer={
        mode.kind === 'accept' ? (
          <>
            <Button
              variant="ghost"
              icon={LogOut}
              busy={mode.signingOut}
              disabled={mode.pending}
              onClick={mode.onSignOut}
              aria-label={t('terms.signOut')}
              title={t('terms.signOut')}
              className="-ml-2 min-w-11 px-3"
            >
              <span className="hidden sm:inline">{t('terms.signOut')}</span>
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={mode.pending}
              onClick={mode.onAccept}
              className="ml-auto"
            >
              {t('terms.accept')}
            </Button>
          </>
        ) : mode.kind === 'agree' ? (
          <>
            <Button variant="ghost" onClick={onClose} className="ml-auto">
              {t('common.close')}
            </Button>
            <Button variant="primary" disabled={!mode.readToEnd} onClick={mode.onAgree}>
              {t(mode.readToEnd ? 'terms.accept' : 'terms.readHint')}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onClose} className="ml-auto">
            {t('terms.done')}
          </Button>
        )
      }
      onSubmit={mode.kind === 'accept' ? mode.onAccept : undefined}
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('terms.intro.app')}</p>
      <p className="-mt-3 text-[14px] leading-5 text-ink-2">
        {beforeLicense}
        <a
          href={licensePage}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 transition-colors duration-150 hover:text-ink"
        >
          {license}
        </a>
        {afterLicense}{' '}
        {t(updating ? 'terms.intro.changed' : 'terms.intro.rules')}
      </p>

      {mode.kind === 'accept' && mode.error && <ErrorNote>{mode.error}</ErrorNote>}

      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : (
        /* The administrator's text, on its own darker panel: it is quoted material, not
           part of the two paragraphs above it, which the app itself writes. No overflow
           clip: the mark below sits whole inside the box. */
        <div className="relative -mt-2 rounded-[12px] border border-line bg-deep p-4 sm:p-5">
          {/* One floating quote mark, drawn rather than typed: a font's own glyph would
              change with the face and cannot be made this blocky. It sits behind the
              first lines, a few shades under the text color, so it reads through them. */}
          <svg
            aria-hidden
            viewBox="0 0 54 42"
            fill="currentColor"
            className="pointer-events-none absolute right-4 top-4 h-10 w-12 text-ink-3/30 sm:right-6 sm:top-5 sm:h-12 sm:w-16"
          >
            {/* Each mark: a square head, and a quarter-ring tail hanging off it and
                curling down-left. Center of each ring is the head's bottom-left corner. */}
            <path d="M0 0 H22 V20 H0 Z" />
            <path d="M22 20 A22 22 0 0 1 0 42 L0 31 A11 11 0 0 0 11 20 Z" />
            <path d="M32 0 H54 V20 H32 Z" />
            <path d="M54 20 A22 22 0 0 1 32 42 L32 31 A11 11 0 0 0 43 20 Z" />
          </svg>
          {html === '' ? (
            <p className="relative text-[14px] leading-5 text-ink-3">{t('terms.empty')}</p>
          ) : (
            <div
              // Positioned, so it paints over the mark instead of under it.
              className="rich-text relative"
              // Sanitized by the server against the allowlist of @dnd/shared before it is
              // stored; see apps/server/src/terms.ts.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      )}

      {/* The end of the text, watched for the "have read" signal. */}
      <span ref={sentinel} aria-hidden className="block h-px w-full" />
    </Dialog>
  );
}

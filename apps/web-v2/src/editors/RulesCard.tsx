import { LOCALES, type Locale, type SetTermsRequest } from '@dnd/shared';
import { Eye, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { useAdminTerms, usePreviewTerms, useSetTerms } from '../api/admin';
import { Button, cx, ErrorNote, Segmented, Spinner } from '../components/ui';
import { TermsDialog } from '../components/TermsDialog';
import { LOCALE_NAMES, useI18n } from '../i18n';
import { RulesEditor } from './RulesEditor';

/** What a language's text holds, for the tab that shows it. */
interface LanguageState {
  empty: boolean;
  unsaved: boolean;
}

/** Tiptap leaves an unwritten document as one empty paragraph. */
const isBlank = (html: string) => html.replace(/<[^>]*>/g, '').trim() === '';

/**
 * The server rules, one text per language, shown to everyone as the terms of service.
 *
 * Whether the server asks anything of its users is a fact about the whole card, so it sits
 * in the header. Which language is on screen is a choice about the text, so it sits on the
 * editor itself, as tabs that also say which languages are still unwritten. Saving sends
 * every language at once: the server moves the version stamp only when some text really
 * changed, so the untouched ones ride along.
 */
export function RulesCard() {
  const { t, errorText, locale: uiLocale } = useI18n();
  const terms = useAdminTerms();
  const save = useSetTerms();
  const previewRun = usePreviewTerms();
  // The draft holds what the admin typed, null while the saved text still stands.
  const [draft, setDraft] = useState<Partial<Record<Locale, string>> | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [locale, setLocale] = useState<Locale>(LOCALES[0]);
  // The preview text comes back sanitized, so it is what readers would get, not what was
  // typed. Held as text: closing drops it, opening again asks the server once more.
  const [preview, setPreview] = useState<string | null>(null);
  const panelId = useId();

  const saved = terms.data;
  if (!saved) {
    return (
      <CardShell>
        {terms.isError ? (
          <ErrorNote>{errorText(terms.error)}</ErrorNote>
        ) : (
          <Spinner label={t('common.loading')} />
        )}
      </CardShell>
    );
  }

  const rules: Record<Locale, string> = { ...saved.rules, ...draft };
  const state = (l: Locale): LanguageState => ({
    empty: isBlank(rules[l]),
    unsaved: rules[l] !== saved.rules[l],
  });
  const on = enabled ?? saved.enabled;
  const dirty = enabled !== null || LOCALES.some((l) => state(l).unsaved);

  const showPreview = () =>
    previewRun.mutate(
      { locale, html: rules[locale] },
      { onSuccess: (result) => setPreview(result.html) },
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: SetTermsRequest = { enabled: on, rules };
    save.mutate(body, {
      // Clearing the draft lets the refetched, sanitized text back the editors.
      onSuccess: () => {
        setDraft(null);
        setEnabled(null);
      },
    });
  };

  // Two labels, so arrow keys move between them: the whole strip is one control.
  const moveTab = (step: number) => {
    const at = LOCALES.indexOf(locale);
    setLocale(LOCALES[(at + step + LOCALES.length) % LOCALES.length]!);
  };

  return (
    <CardShell
      status={
        <div className="w-full sm:w-[168px] sm:shrink-0">
          <Segmented
            label={t('admin.terms.visible')}
            value={on ? 'on' : 'off'}
            onChange={(v) => setEnabled(v === 'on')}
            options={[
              { value: 'on', label: t('admin.terms.on') },
              { value: 'off', label: t('admin.terms.off') },
            ]}
          />
        </div>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {save.isError && <ErrorNote>{errorText(save.error)}</ErrorNote>}

        <RulesEditor
          label={LOCALE_NAMES[locale]}
          panelId={panelId}
          panelLabelledBy={`${panelId}-${locale}`}
          value={rules[locale]}
          // Only the language on screen: `rules` below already fills the others from what
          // is saved, so every language keeps its own draft while the admin works through
          // them, and one save carries them all.
          onChange={(html) => setDraft((d) => ({ ...d, [locale]: html }))}
          tabs={
            // No bar of its own: the chips sit on the card and the box below carries the
            // border, so the chosen language reads as the one the box is showing.
            <div
              role="tablist"
              aria-label={t('admin.terms.language')}
              className="flex items-stretch gap-1"
            >
              {LOCALES.map((l) => {
                const active = l === locale;
                const { empty, unsaved } = state(l);
                return (
                  <button
                    key={l}
                    type="button"
                    role="tab"
                    id={`${panelId}-${l}`}
                    aria-selected={active}
                    aria-controls={panelId}
                    onClick={() => setLocale(l)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight') {
                        e.preventDefault();
                        moveTab(1);
                      } else if (e.key === 'ArrowLeft') {
                        e.preventDefault();
                        moveTab(-1);
                      }
                    }}
                    className={cx(
                      'flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] bg-raised px-3 text-[13px] leading-5 transition-colors duration-150 sm:flex-none sm:px-4',
                      active
                        ? 'text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
                        : cx(
                            'bg-raised/40 hover:bg-raised hover:text-ink',
                            empty ? 'text-ink-3' : 'text-ink-2',
                          ),
                    )}
                  >
                    {/* Unsaved work, in the neutral ramp: the lamp is reserved for sound. */}
                    {unsaved && (
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink" />
                    )}
                    <span className="truncate">{LOCALE_NAMES[l]}</span>
                    <span className="sr-only">
                      {unsaved && t('admin.terms.unsaved')}
                      {empty && !unsaved && t('admin.terms.blank')}
                    </span>
                  </button>
                );
              })}
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={!dirty}>
            {t('common.save')}
          </Button>
          {/* Back to what is saved, in every language and the toggle, without a reload. */}
          <Button
            variant="ghost"
            icon={RotateCcw}
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(null);
              setEnabled(null);
            }}
          >
            {t('admin.terms.reset')}
          </Button>
          <Button variant="ghost" icon={Eye} busy={previewRun.isPending} onClick={showPreview}>
            {t('admin.terms.preview')}
          </Button>
          <span className="text-[13px] leading-5 text-ink-3" role="status">
            {save.isSuccess && !dirty && t('admin.terms.saved')}
          </span>
          {saved.updatedAt && (
            <span className="ml-auto text-[13px] leading-5 text-ink-3 tabular-nums">
              {t('admin.terms.updatedAt', {
                at: new Intl.DateTimeFormat(uiLocale, { dateStyle: 'medium' }).format(
                  new Date(saved.updatedAt),
                ),
              })}
            </span>
          )}
        </div>
      </form>

      {preview !== null && (
        <TermsDialog
          mode={{ kind: 'read' }}
          updating={false}
          preview={{ html: preview }}
          onClose={() => setPreview(null)}
        />
      )}
    </CardShell>
  );
}

/** The card frame the Admin page gives every setting, with its status at the head. */
function CardShell({ children, status }: { children: React.ReactNode; status?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-4 rounded-[16px] border border-line bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[13px] leading-5 text-ink-2">{t('admin.terms')}</h2>
          <p className="max-w-[46ch] text-[13px] leading-5 text-ink-3">{t('admin.terms.hint')}</p>
        </div>
        {status}
      </div>
      {children}
    </section>
  );
}

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Button, Spinner } from './ui';

/** One icon set as `scripts/build-icon-libraries.mjs` writes it into `/icons/index.json`. */
interface IconLibrary {
  id: string;
  label: string;
  /** The licence, then who holds it: `CC-BY 4.0 — Twitter and contributors`. */
  licence: string;
  version: string;
  count: number;
}

/**
 * Where each icon set comes from and the text of its licence. A CC-BY credit needs the
 * title, the author, the source and the licence, so every card carries all four.
 */
const ICON_LINKS: Record<string, { home: string; licence: string }> = {
  tabler: {
    home: 'https://tabler.io/icons',
    licence: 'https://github.com/tabler/tabler-icons/blob/main/LICENSE',
  },
  lucide: { home: 'https://lucide.dev', licence: 'https://lucide.dev/license' },
  healthicons: {
    home: 'https://healthicons.org',
    licence: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  material: {
    home: 'https://fonts.google.com/icons',
    licence: 'https://www.apache.org/licenses/LICENSE-2.0',
  },
  twemoji: {
    home: 'https://github.com/discord/twemoji',
    licence: 'https://creativecommons.org/licenses/by/4.0/',
  },
};

/** The typefaces bundled with the app, all under the SIL Open Font License. */
const FONTS = [
  {
    id: 'instrument-sans',
    label: 'Instrument Sans',
    licence: 'OFL-1.1 — The Instrument Sans Project Authors',
    home: 'https://github.com/Instrument/instrument-sans',
  },
  {
    id: 'geist-mono',
    label: 'Geist Mono',
    licence: 'OFL-1.1 — The Geist Project Authors',
    home: 'https://github.com/vercel/geist-font',
  },
  {
    id: 'cinzel',
    label: 'Cinzel',
    licence: 'OFL-1.1 — The Cinzel Project Authors',
    home: 'https://github.com/NDISCOVER/Cinzel',
  },
];
const OFL = 'https://openfontlicense.org';
/** Bundled versions, read from the font packages when the app is built. */
const FONT_VERSIONS = JSON.parse(
  (import.meta.env.VITE_FONT_VERSIONS as string | undefined) ?? '{}',
) as Record<string, string>;

const LINK =
  'inline-flex items-center gap-1 underline underline-offset-4 transition-colors duration-150 hover:text-ink';

function Out({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK} ${className ?? ''}`}>
      {children}
    </a>
  );
}

/** One credited work: its name and source, what it is, its licence, and any extra note. */
function CreditCard({
  label,
  home,
  meta,
  licence,
  licenceUrl,
  children,
}: {
  label: string;
  home?: string;
  meta: string;
  licence: string;
  licenceUrl?: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-[14px] border border-line bg-deep px-4 py-3">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
        {home ? (
          <Out href={home} className="text-[15px] leading-6 font-medium text-ink">
            {label}
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden />
          </Out>
        ) : (
          <span className="text-[15px] leading-6 font-medium">{label}</span>
        )}
        <span className="text-[12px] leading-4 text-ink-3 tabular-nums">{meta}</span>
      </span>
      <span className="text-[13px] leading-5 text-ink-2">
        {licenceUrl ? <Out href={licenceUrl}>{licence}</Out> : licence}
      </span>
      {children}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] leading-5 text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

/** The open source icon sets and typefaces the app is built on, each with its licence. */
export function CreditsDialog({ onClose }: { onClose: () => void }) {
  const { t, tn } = useI18n();
  const libraries = useQuery({
    // The icon picker reads the same file under the same key: one fetch for both.
    queryKey: ['icons', 'index'],
    queryFn: async () => {
      const res = await fetch('/icons/index.json');
      if (!res.ok) throw new Error(`/icons/index.json: ${res.status}`);
      return (await res.json()) as IconLibrary[];
    },
    staleTime: Infinity,
  });

  return (
    <Dialog
      title={t('credits.title')}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} className="ml-auto">
          {t('common.close')}
        </Button>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('credits.intro')}</p>

      <Section title={t('credits.icons')}>
        {libraries.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : libraries.isError || !libraries.data ? (
          <p className="text-[14px] leading-5 text-danger">{t('common.loadFailed')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {libraries.data.map((library) => (
              <CreditCard
                key={library.id}
                label={library.label}
                home={ICON_LINKS[library.id]?.home}
                meta={`${tn('credits.count', library.count)} ${library.version}`}
                licence={library.licence}
                licenceUrl={ICON_LINKS[library.id]?.licence}
              >
                {library.id === 'twemoji' && (
                  <span className="text-[12px] leading-4 text-ink-3">
                    {t('credits.emojiNames')}{' '}
                    <Out href="https://emojibase.dev">emojibase-data</Out> (MIT)
                  </span>
                )}
              </CreditCard>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('credits.fonts')}>
        <ul className="flex flex-col gap-2">
          {FONTS.map((font) => (
            <CreditCard
              key={font.id}
              label={font.label}
              home={font.home}
              meta={FONT_VERSIONS[font.id] ?? ''}
              licence={font.licence}
              licenceUrl={OFL}
            />
          ))}
        </ul>
      </Section>

      {/* The logos that stand for a licence: used nominatively, not assets under a content
          licence — the CC marks are Creative Commons' trademarks, the Pixabay logo is the
          public-domain file from Wikimedia Commons. */}
      <Section title={t('credits.marks')}>
        <ul className="flex flex-col gap-2">
          <CreditCard
            label="Creative Commons"
            home="https://creativecommons.org/presskit/"
            meta={t('credits.marks.pressKit')}
            licence={t('credits.marks.cc')}
          />
          <CreditCard
            label="Pixabay"
            home="https://pixabay.com/"
            meta={t('credits.marks.logo')}
            licence={t('credits.marks.pixabay')}
          />
        </ul>
      </Section>
    </Dialog>
  );
}

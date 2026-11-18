import type { Illustration as IllustrationData, IllustrationInput } from '@dnd/shared';
import { useQuery } from '@tanstack/react-query';
import { Images, ImageUp, Shapes, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReusableImages } from '../api/hooks';
import { useI18n } from '../i18n';
import { Dialog } from './Dialog';
import { Illustration, type IllustrationDraft } from './Illustration';
import { matches } from './Page';
import { Button, cx, IconButton, SearchField, Select, Spinner } from './ui';

interface IconLibrary {
  id: string;
  label: string;
  count: number;
}
interface IconSetFile {
  icons: Record<string, { m: string; l: string }>;
}

/** Grid sizing for the virtualised rows: square cells at least 44px wide, gap-1 between. */
const GRID_GAP = 4;
const MIN_CELL = 44;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * What to send when saving a draft: the JSON `illustration` field, the image file, or
 * neither when nothing changed. An image is its own upload, so it never goes in the body.
 */
export function illustrationChanges(
  draft: IllustrationDraft,
  original: IllustrationData,
): { illustration?: IllustrationInput; image?: File } {
  if (draft.type === 'file') return { image: draft.file };
  if (draft.type === 'icon') {
    return original.type === 'icon' && original.iconId === draft.iconId
      ? {}
      : { illustration: { type: 'icon', iconId: draft.iconId } };
  }
  if (draft.type === 'none') {
    return original.type === 'none' ? {} : { illustration: { type: 'none' } };
  }
  if (original.type === 'image' && original.url === draft.url) return {};
  return { illustration: { type: 'image', imageKey: imageKeyOf(draft.url) } };
}

/** The key of a stored image, the last segment of its `/api/images/<key>` address. */
export const imageKeyOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);

/** Picks how an item looks: an icon from the libraries, an uploaded image, or nothing. */
export function IllustrationField({
  value,
  onChange,
  fallback,
  maxImageBytes,
}: {
  value: IllustrationDraft;
  onChange: (value: IllustrationDraft) => void;
  fallback: LucideIcon;
  maxImageBytes: number;
}) {
  const { t, bytes } = useI18n();
  const [picking, setPicking] = useState<'icon' | 'image' | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Preview URLs of picked files are released when replaced or when the editor closes.
  const objectUrl = value.type === 'file' ? value.url : null;
  useEffect(() => () => void (objectUrl && URL.revokeObjectURL(objectUrl)), [objectUrl]);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > maxImageBytes) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    setPicking(null);
    onChange({ type: 'file', file, url: URL.createObjectURL(file) });
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-[13px] leading-5 text-ink-2">{t('illustration.label')}</span>
      <div className="flex items-center gap-4">
        <span className="relative block size-20 shrink-0 overflow-hidden rounded-[12px] border border-line bg-deep">
          <Illustration value={value} fallback={fallback} iconClassName="size-9" />
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            icon={Shapes}
            aria-expanded={picking === 'icon'}
            onClick={() => setPicking((v) => (v === 'icon' ? null : 'icon'))}
          >
            {t('illustration.icon')}
          </Button>
          <Button
            icon={Images}
            aria-expanded={picking === 'image'}
            onClick={() => setPicking((v) => (v === 'image' ? null : 'image'))}
          >
            {t('illustration.reuse')}
          </Button>
          <Button icon={ImageUp} onClick={() => fileInput.current?.click()}>
            {t('illustration.image')}
          </Button>
          <IconButton
            icon={Trash2}
            label={t('illustration.none')}
            disabled={value.type === 'none'}
            onClick={() => onChange({ type: 'none' })}
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-label={t('illustration.image')}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <p className={cx('text-[13px] leading-5', tooLarge ? 'text-danger' : 'text-ink-3')}>
        {t('illustration.imageHint', { size: bytes(maxImageBytes) })}
      </p>
      {/* Pickers open over the editor, which keeps its size; picking returns to it. */}
      {picking === 'icon' && (
        <Dialog title={t('illustration.icon')} onClose={() => setPicking(null)} fixedHeight>
          <IconPicker
            selected={value.type === 'icon' ? value.iconId : null}
            onPick={(iconId, svg) => {
              onChange({ type: 'icon', iconId, svg });
              setPicking(null);
            }}
          />
        </Dialog>
      )}
      {picking === 'image' && (
        <Dialog title={t('illustration.reuse')} onClose={() => setPicking(null)} fixedHeight>
          <ImagePicker
            selected={value.type === 'image' ? value.url : null}
            onPick={(url) => {
              onChange({ type: 'image', url });
              setPicking(null);
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

/** The images already shown on the user's items, and on items they added, to use again. */
function ImagePicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (url: string) => void;
}) {
  const { t } = useI18n();
  const images = useReusableImages(true);

  return (
    <div className="scroll-quiet -mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
      {images.isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : images.isError ? (
        <p className="text-[13px] leading-5 text-danger">{t('common.loadFailed')}</p>
      ) : images.data?.length === 0 ? (
        <p className="text-[13px] leading-5 text-ink-3">{t('illustration.noImages')}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] gap-2">
          {images.data?.map((image) => (
            <li key={image.key}>
              <button
                type="button"
                aria-label={t('illustration.reuseItem')}
                aria-pressed={image.url === selected}
                onClick={() => onPick(image.url)}
                className={cx(
                  'relative block aspect-square w-full overflow-hidden rounded-[8px] border transition-colors duration-150',
                  image.url === selected ? 'border-ink' : 'border-line hover:border-line-strong',
                )}
              >
                <img
                  src={image.url}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="absolute inset-0 size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IconPicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (iconId: string, svg: string) => void;
}) {
  const { t, locale } = useI18n();
  const libraries = useQuery({
    queryKey: ['icons', 'index'],
    queryFn: () => getJson<IconLibrary[]>('/icons/index.json'),
    staleTime: Infinity,
  });
  const [libraryId, setLibraryId] = useState<string | null>(selected?.split(':')[0] ?? null);
  const current = libraryId ?? libraries.data?.[0]?.id ?? null;
  const set = useQuery({
    queryKey: ['icons', current],
    queryFn: () => getJson<IconSetFile>(`/icons/${current}.json`),
    enabled: current !== null,
    staleTime: Infinity,
  });
  const [query, setQuery] = useState('');

  const all = useMemo(() => Object.entries(set.data?.icons ?? {}), [set.data]);
  const found = useMemo(
    () => (query.trim() ? all.filter(([slug, icon]) => matches(`${icon.l} ${slug}`, query)) : all),
    [all, query],
  );
  const cells = useMemo(
    () =>
      found.map(([slug, icon]) => ({
        iconId: `${current}:${slug}`,
        markup: icon.m,
        label: icon.l,
      })),
    [found, current],
  );

  if (libraries.isError) {
    return <p className="text-[13px] leading-5 text-danger">{t('illustration.iconsMissing')}</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
        <Select
          value={current ?? ''}
          onChange={(e) => setLibraryId(e.target.value)}
          aria-label={t('illustration.icon')}
        >
          {libraries.data?.map((lib) => (
            <option key={lib.id} value={lib.id}>
              {lib.label}
            </option>
          ))}
        </Select>
        <SearchField value={query} onChange={setQuery} label={t('common.search')} />
      </div>
      {/* Loading and errors keep the dialog's height; only the icons scroll. */}
      {set.isLoading || libraries.isLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : set.isError ? (
        <p className="text-[13px] leading-5 text-danger">{t('illustration.iconsMissing')}</p>
      ) : (
        <IconGrid cells={cells} selected={selected} onPick={onPick} />
      )}
      <p className="h-4 shrink-0 text-[12px] leading-4 text-ink-3 tabular-nums">
        {set.data &&
          (query.trim() && found.length === 0
            ? t('common.noMatch', { query: query.trim() })
            : t('illustration.iconCount', {
                n: new Intl.NumberFormat(locale).format(found.length),
              }))}
      </p>
    </div>
  );
}

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);

/** The icon buttons, virtualised: only the rows on screen are in the DOM, so the whole
 * set (thousands) can be shown. Rows are uniform squares of at least 44px with a gap
 * between them — the CSS grid here is built from the same numbers the scroll math uses. */
function IconGrid({
  cells,
  selected,
  onPick,
}: {
  cells: { iconId: string; markup: string; label: string }[];
  selected: string | null;
  onPick: (iconId: string, svg: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  // The dialog fixes this area's height; the observer tracks resizes (rotation, split view).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A new search or library starts from the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
  }, [cells]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const cols = Math.max(1, Math.floor((box.width + GRID_GAP) / (MIN_CELL + GRID_GAP)));
  const cell = (box.width - GRID_GAP * (cols - 1)) / cols;
  const rowHeight = cell + GRID_GAP;
  const rows = Math.ceil(cells.length / cols);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - 1);
  const last = Math.min(rows, Math.ceil((scrollTop + box.height) / rowHeight) + 1);

  // Scroll events can outpace frames; one update per frame is enough.
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(scroller.current?.scrollTop ?? 0));
  };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="scroll-quiet -mx-2 min-h-0 flex-1 overflow-y-auto px-2"
    >
      <div className="relative w-full" style={{ height: Math.max(0, rows * rowHeight - GRID_GAP) }}>
        {range(first, last).map((row) => (
          <div
            key={row}
            className="absolute left-0 right-0 grid"
            style={{
              top: row * rowHeight,
              height: cell,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              columnGap: GRID_GAP,
            }}
          >
            {cells.slice(row * cols, row * cols + cols).map((item) => (
              <button
                key={item.iconId}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-pressed={item.iconId === selected}
                onClick={() => onPick(item.iconId, item.markup)}
                className={cx(
                  'flex aspect-square w-full items-center justify-center rounded-[8px] transition-colors duration-150',
                  item.iconId === selected
                    ? 'bg-raised text-lamp'
                    : 'text-ink-2 hover:bg-raised hover:text-ink',
                )}
              >
                <span
                  className="svg-fill block size-6"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: item.markup }}
                />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

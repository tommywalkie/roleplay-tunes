import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { cx, IconButton } from './ui';

/**
 * Open dialogs, oldest first. Only the newest is shown: a dialog opened from another one
 * replaces it on screen, while the one below stays mounted and keeps its form state.
 * Closing the newest brings the one below back.
 */
let stack: string[] = [];
const listeners = new Set<() => void>();
const setStack = (next: string[]) => {
  stack = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getStack = () => stack;

/**
 * A sheet from the bottom on phones, a centered panel from tablet width up. The title
 * and the footer stay in place; only the body scrolls.
 */
export function Dialog({
  title,
  onClose,
  onSubmit,
  footer,
  children,
  fixedHeight = false,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  /** When set, the dialog is a form and the footer's submit button triggers this. */
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /**
   * Keeps one height whatever the content, for pickers whose content loads or filters:
   * the body does not scroll, the content scrolls its own list.
   */
  fixedHeight?: boolean;
  /** False for a dialog that must be answered: no close button, no backdrop, no Escape. */
  dismissible?: boolean;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLFormElement>(null);
  const open = useSyncExternalStore(subscribe, getStack);
  const onTop = open.at(-1) === titleId;
  // Over another dialog, it shares that one's dim layer. Before its first effect it is not
  // in the stack yet: then any open dialog is below it.
  const position = open.indexOf(titleId);
  const stacked = position === -1 ? open.length > 0 : position > 0;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    setStack([...stack, titleId]);
    return () => {
      setStack(stack.filter((id) => id !== titleId));
      previous?.focus?.();
    };
  }, [titleId]);

  useEffect(() => {
    if (!onTop || !dismissible) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onTop, dismissible]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSubmit?.();
  };

  return createPortal(
    <div
      data-dialog-state={onTop ? 'shown' : 'covered'}
      className="fixed inset-0 z-50 flex items-end justify-center pt-[var(--safe-top)] md:items-center md:p-6 md:pt-[max(24px,var(--safe-top))]"
    >
      {/* One dim layer for the whole stack: the first dialog's stays put while a second one
          covers it, so the page behind never flashes back. */}
      <div
        className={cx('absolute inset-0', !stacked && 'animate-fade bg-black/60')}
        onClick={dismissible ? onClose : undefined}
        aria-hidden
      />
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onSubmit={submit}
        noValidate
        className={cx(
          'relative max-h-[92dvh] w-full animate-sheet flex-col rounded-t-[20px] border border-line bg-card outline-none md:max-h-[86dvh] md:max-w-[560px] md:rounded-[20px]',
          onTop ? 'flex' : 'hidden',
          fixedHeight && 'h-[92dvh] md:h-[min(720px,86dvh)]',
        )}
      >
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line pl-6 pr-3">
          <h2 id={titleId} className="truncate text-[17px] leading-6 font-medium">
            {title}
          </h2>
          {dismissible && <IconButton icon={X} label={t('common.close')} onClick={onClose} />}
        </header>
        <div
          className={cx(
            'scroll-quiet flex min-h-0 flex-1 flex-col gap-6 px-6 py-6',
            fixedHeight ? 'overflow-hidden' : 'overflow-y-auto',
            !footer && 'pb-[max(24px,var(--safe-bottom))]',
          )}
        >
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-4 pb-[max(16px,var(--safe-bottom))]">
            {footer}
          </footer>
        )}
      </form>
    </div>,
    document.body,
  );
}

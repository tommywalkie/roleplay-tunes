import { X } from 'lucide-react';
import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { IconButton } from './ui';

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
}: {
  title: string;
  onClose: () => void;
  /** When set, the dialog is a form and the footer's submit button triggers this. */
  onSubmit?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const panel = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSubmit?.();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade bg-black/60" onClick={onClose} aria-hidden />
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onSubmit={submit}
        noValidate
        className="relative flex max-h-[92dvh] w-full animate-sheet flex-col rounded-t-[20px] border border-line bg-card outline-none md:max-h-[86dvh] md:max-w-[560px] md:rounded-[20px]"
      >
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line pl-6 pr-3">
          <h2 id={titleId} className="truncate text-[17px] leading-6 font-medium">
            {title}
          </h2>
          <IconButton icon={X} label={t('common.close')} onClick={onClose} />
        </header>
        <div className="scroll-quiet flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            {footer}
          </footer>
        )}
      </form>
    </div>,
    document.body,
  );
}

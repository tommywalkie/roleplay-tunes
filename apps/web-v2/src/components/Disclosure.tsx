import { ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cx, Icon } from './ui';

/**
 * A section of a form that folds away. Open to begin with, its header a plain button, so
 * the fields inside stay reachable by keyboard as usual.
 *
 * The panel animates its own height (a grid row from `0fr` to `1fr`) with the app's one
 * easing, along with its opacity, so nothing jumps when it is toggled.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="flex flex-col rounded-[14px] border border-line bg-deep/40">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 rounded-[14px] px-4 text-left text-[14px] leading-5 font-medium text-ink transition-colors duration-150 ease-out hover:bg-raised/60"
      >
        {title}
        <Icon
          icon={ChevronDown}
          className={cx(
            'ml-auto text-ink-3 transition-transform duration-200 ease-out',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        id={id}
        className={cx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="flex min-w-0 flex-col gap-6 px-4 pt-1 pb-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

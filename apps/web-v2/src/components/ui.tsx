import { LoaderCircle, Search, type LucideIcon } from 'lucide-react';
import {
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Line icons: one size, one stroke, the color of their text. */
export function Icon({ icon: Glyph, className }: { icon: LucideIcon; className?: string }) {
  return <Glyph size={18} strokeWidth={1.5} aria-hidden className={cx('shrink-0', className)} />;
}

const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-[14px] leading-5 font-medium ' +
  'transition-[background-color,border-color,color,transform,opacity] duration-150 ease-out ' +
  'active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100';

const BUTTON_VARIANTS = {
  /** The one main action of a view: off-white on the dark surface. */
  primary: 'bg-ink text-deep hover:bg-white',
  secondary: 'border border-line bg-raised text-ink hover:bg-raised-hover',
  ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
  danger: 'text-danger hover:bg-danger/10',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  icon?: LucideIcon;
  busy?: boolean;
}

export function Button({
  variant = 'secondary',
  icon,
  busy,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], 'h-11 px-4', className)}
      {...rest}
    >
      {busy ? <Icon icon={LoaderCircle} className="animate-spin" /> : icon && <Icon icon={icon} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name; icon-only buttons always have one. */
  label: string;
  variant?: keyof typeof BUTTON_VARIANTS;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], 'size-11', className)}
      {...rest}
    >
      <Icon icon={icon} />
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[13px] leading-5 text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[13px] leading-5 text-danger">{error}</p>
      ) : (
        hint && <p className="text-[13px] leading-5 text-ink-3">{hint}</p>
      )}
    </div>
  );
}

const INPUT =
  'h-11 w-full rounded-[10px] border border-line bg-raised px-3 text-[15px] text-ink ' +
  'placeholder:text-ink-3 transition-colors duration-150 hover:border-line-strong ' +
  'focus:border-line-strong focus:outline-2 focus:outline-offset-0 focus:outline-lamp';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(INPUT, className)} {...rest} />;
}

export function SearchField({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <Icon
        icon={Search}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className={cx(INPUT, 'pl-10 [&::-webkit-search-cancel-button]:appearance-none')}
      />
    </div>
  );
}

/** A small set of exclusive choices, shown all at once. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-[12px] border border-line bg-deep p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-9 items-center justify-center gap-2 rounded-[8px] px-2 text-[14px] leading-5',
            'transition-[background-color,color] duration-150',
            o.value === value
              ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.icon && <Icon icon={o.icon} className="hidden sm:block" />}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A volume fader, 0..1. `lit` paints the filled part in the lamp color. */
export function Fader({
  value,
  onChange,
  label,
  lit,
  disabled,
  id,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  lit?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const style = {
    '--v': value,
    ...(lit ? { '--fader-fill': 'var(--color-lamp)' } : {}),
  } as CSSProperties;
  return (
    <input
      id={id}
      type="range"
      className={cx('fader', disabled && 'opacity-45')}
      min={0}
      max={1}
      step={0.01}
      value={value}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={`${Math.round(value * 100)}%`}
      onChange={(e) => onChange(Number(e.target.value))}
      style={style}
    />
  );
}

/** Percentage in tabular mono figures, fixed width so rows never shift. */
export function Percent({ value }: { value: number }) {
  return (
    <span className="w-8 shrink-0 text-right font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
      {Math.round(value * 100)}
    </span>
  );
}

/** The signature detail: a small lamp, lit only while something makes sound. */
export function Lamp({ on, className }: { on: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      data-on={on || undefined}
      className={cx(
        'block size-2 shrink-0 rounded-full bg-line-strong transition-colors duration-150 data-[on]:bg-lamp',
        className,
      )}
    />
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex h-40 items-center justify-center text-ink-3">
      <Icon icon={LoaderCircle} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-[16px] border border-dashed border-line-strong px-6 py-10">
      <Icon icon={icon} className="text-ink-3" />
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] leading-6 font-medium text-ink">{title}</h2>
        {body && <p className="max-w-[44ch] text-[14px] leading-5 text-ink-2">{body}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-[10px] bg-danger/10 px-3 py-2 text-[14px] leading-5 text-danger">
      {children}
    </p>
  );
}

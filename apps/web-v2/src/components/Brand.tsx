import { cx } from './ui';

/**
 * The product mark: three level bars, the flat sign of a mixing desk.
 * `scripts/build-brand-assets.mjs` draws the favicons and the social preview from it, so
 * changing the geometry here means re-running that script.
 */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden
      className={cx('shrink-0 text-lamp', className)}
    >
      <rect x="2" y="8" width="4" height="10" rx="1" fill="currentColor" />
      <rect x="8" y="2" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="11" width="4" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

/** The product name in the inscriptional face. Caps only: the face has no lowercase. */
export function Wordmark({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cx(
        'font-display leading-none font-semibold text-ink',
        size === 'md'
          ? 'text-[17px] tracking-[0.1em]'
          : 'text-[14px] tracking-[0.09em]',
      )}
    >
      {name}
    </span>
  );
}

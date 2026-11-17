import { cx } from './ui';

/** Colors of the mark: lamp amber for the blade, a shade darker for the gold and the note. */
const BLADE_LIGHT = '#f7bf6d';
const BLADE = '#f0a23b';
const GOLD = '#d98a26';
const GRIP = '#9c5f1d';
const GRIP_DARK = '#6e3f0f';

/**
 * The product mark: a cartoon sword and a music note, side by side.
 * `scripts/build-brand-assets.mjs` draws the favicons and the social preview from the same
 * geometry, so changing it here means changing it there and re-running that script.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className={cx('shrink-0', className)}
    >
      <g transform="translate(21 33) rotate(45) scale(1.06)">
        <path d="M5 6 V-21 L0 -29 V6 Z" fill={BLADE} />
        <path d="M-5 6 V-21 L0 -29 L0.2 -28.7 V6 Z" fill={BLADE_LIGHT} />
        <rect x="-3.2" y="7" width="6.4" height="14" rx="1" fill={GRIP} />
        <path
          d="M-3.2 10 L3.2 8 V10 L-3.2 12 Z M-3.2 14 L3.2 12 V14 L-3.2 16 Z M-3.2 18 L3.2 16 V18 L-3.2 20 Z"
          fill={GRIP_DARK}
        />
        <path
          d="M-11 9 Q-11 5 -7 5 H7 Q11 5 11 9 A2.4 2.4 0 0 1 6.4 9.6 Q6 8.4 4.6 8.4 H-4.6 Q-6 8.4 -6.4 9.6 A2.4 2.4 0 0 1 -11 9 Z"
          fill={GOLD}
        />
        <path d="M-4.6 21 H4.6 A4.6 4.6 0 0 1 -4.6 21 Z" fill={GOLD} />
      </g>
      <g fill={GOLD}>
        <path d="M52.6 49.3 V11.2 Q52.6 10 53.8 10 H55 Q56 10 56.2 11 C57 17 63.6 20 63.2 30 C63 34 61.8 37 60.4 39 C61.4 33 60.2 26.4 56.2 23.4 V49.3 Z" />
        <ellipse cx="49.67" cy="50.56" rx="6.8" ry="4.9" transform="rotate(-24 49.67 50.56)" />
      </g>
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

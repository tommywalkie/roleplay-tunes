/**
 * Category colors. The background is the user's choice; the text on it is white or dark
 * slate, whichever reads better on that background.
 */

/** Presets tuned to the dark interface: muted, and far enough apart to tell at a glance. */
export const CATEGORY_PALETTE = [
  '#8b3a3a',
  '#b5653a',
  '#c9a227',
  '#5a7d3a',
  '#2f6f62',
  '#3b5b8c',
  '#6b4f8a',
  '#8a8478',
] as const;

export const DARK_TEXT = '#1e293b';
export const LIGHT_TEXT = '#ffffff';

/** Relative luminance of a `#rrggbb` color (WCAG 2). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** White or dark slate, whichever has more contrast on the background. */
export function textOn(background: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(background)) return LIGHT_TEXT;
  const bg = luminance(background);
  return contrast(bg, luminance(LIGHT_TEXT)) >= contrast(bg, luminance(DARK_TEXT))
    ? LIGHT_TEXT
    : DARK_TEXT;
}

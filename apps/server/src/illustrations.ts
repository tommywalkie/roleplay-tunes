/**
 * Illustrations of sounds, mixes and scenes: an icon from one of the
 * built icon sets, or an uploaded image.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Illustration, IllustrationInput } from '@dnd/shared';
import { config } from './config.js';
import { invalid } from './errors.js';
import { reusableImage } from './sharing.js';

/** The illustration columns every illustrated table has. */
export interface IllustrationColumns {
  illustrationType: 'none' | 'icon' | 'image';
  iconId: string | null;
  iconSvg: string | null;
  imageKey: string | null;
  imageBytes: number;
}

/** Shape of one built icon set file: `<iconsDir>/<set>.json`. */
interface IconSetFile {
  icons: Record<string, { m: string }>;
}

const iconSets = new Map<string, IconSetFile | null>();

function loadIconSet(set: string): IconSetFile | null {
  if (!iconSets.has(set)) {
    const file = join(config.iconsDir, `${set}.json`);
    iconSets.set(
      set,
      existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as IconSetFile) : null,
    );
  }
  return iconSets.get(set) ?? null;
}

/** SVG markup of an icon id such as `tabler:door`, from the server's own copy of the sets. */
export function resolveIconSvg(iconId: string): string {
  const [set, slug] = iconId.split(':');
  const markup = loadIconSet(set)?.icons[slug]?.m;
  if (!markup) throw invalid('Unknown icon', { 'illustration.iconId': 'Unknown icon' });
  return markup;
}

export function toIllustration(row: IllustrationColumns): Illustration {
  if (row.illustrationType === 'icon' && row.iconId && row.iconSvg) {
    return { type: 'icon', iconId: row.iconId, svg: row.iconSvg };
  }
  if (row.illustrationType === 'image' && row.imageKey) {
    return { type: 'image', url: `/api/images/${row.imageKey}` };
  }
  return { type: 'none' };
}

/**
 * Column values for an illustration a client asked for. The caller releases the previous
 * image, if any, once the change is saved.
 */
export function illustrationValues(input: IllustrationInput, userId: string): IllustrationColumns {
  const cleared = { imageKey: null, imageBytes: 0 };
  if (input.type === 'image') {
    const image = reusableImage(userId, input.imageKey);
    return {
      illustrationType: 'image',
      iconId: null,
      iconSvg: null,
      imageKey: image.key,
      imageBytes: image.bytes,
    };
  }
  if (input.type === 'icon') {
    return {
      illustrationType: 'icon',
      iconId: input.iconId,
      iconSvg: resolveIconSvg(input.iconId),
      ...cleared,
    };
  }
  return { illustrationType: 'none', iconId: null, iconSvg: null, ...cleared };
}

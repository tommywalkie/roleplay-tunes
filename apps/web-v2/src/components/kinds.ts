import type { PlayMode } from '@dnd/shared';
import { AudioLines, Layers, Map as MapIcon, Repeat, Shuffle, Zap, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../i18n/en';

/** Shown on a tile when no icon or image was chosen. */
export const FALLBACK_ICONS = { sound: AudioLines, mix: Layers, scene: MapIcon } as const;

export const MODE_ICONS: Record<PlayMode, LucideIcon> = {
  loop: Repeat,
  recurring: Shuffle,
  oneshot: Zap,
};

export const MODE_LABELS: Record<PlayMode, MessageKey> = {
  loop: 'mode.loop',
  recurring: 'mode.recurring',
  oneshot: 'mode.oneshot',
};

export const MODE_HINTS: Record<PlayMode, MessageKey> = {
  loop: 'mode.loop.hint',
  recurring: 'mode.recurring.hint',
  oneshot: 'mode.oneshot.hint',
};

export const MODE_ORDER: PlayMode[] = ['loop', 'recurring', 'oneshot'];

import type { MixKind, PlayMode } from '@dnd/shared';
import {
  AudioLines,
  Layers,
  ListMusic,
  Map as MapIcon,
  Repeat,
  Shuffle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '../i18n/en';

/** Shown on a tile when no icon or image was chosen. */
export const FALLBACK_ICONS = {
  sound: AudioLines,
  mix: Layers,
  playlist: ListMusic,
  scene: MapIcon,
} as const;

/** What a mix object is: sounds played together, or one after another. */
export const KIND_ICONS: Record<MixKind, LucideIcon> = { mix: Layers, playlist: ListMusic };

export const KIND_LABELS: Record<MixKind, MessageKey> = {
  mix: 'kind.mix',
  playlist: 'kind.playlist',
};

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

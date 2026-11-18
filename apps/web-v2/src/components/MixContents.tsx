import type { Mix, Sound } from '@dnd/shared';
import { Check, Minus, Plus } from 'lucide-react';
import { FALLBACK_ICONS, MODE_ICONS, MODE_LABELS } from './kinds';
import { LicenseBadge } from './LicenseBadge';
import { Thumb } from './Illustration';
import { cx } from './ui';
import { useI18n } from '../i18n';

/**
 * What a mix is made of, as a list: each sound with how it plays, how long it is, what it
 * is licensed under, and whether the user already has it. The same list answers three
 * questions, so it is one component: what am I about to take on (adding the mix), what
 * would I keep (removing it), and what has to become public first.
 */
export function MixContents({
  mix,
  byId,
  /** Whose sounds the user already holds, by id: own and added alike. */
  heldIds,
  /** Which sounds can be taken out on their own. Absent: the line only says "held". */
  selectable,
  chosen,
  onChosen,
}: {
  mix: Mix;
  byId: Map<string, Sound>;
  heldIds: Set<string>;
  selectable?: Set<string>;
  chosen?: Set<string>;
  onChosen?: (ids: Set<string>) => void;
}) {
  const { t, tn, duration } = useI18n();

  return (
    <ul
      aria-label={t('mix.contents', { name: mix.name })}
      className="flex flex-col overflow-hidden rounded-[12px] border border-line"
    >
      {mix.items.map((item) => {
        const sound = byId.get(item.soundId);
        const name = sound?.name ?? t('player.unknownSound');
        const held = heldIds.has(item.soundId);
        const canChoose = selectable?.has(item.soundId) ?? false;
        const on = chosen?.has(item.soundId) ?? false;
        const ModeIcon = sound ? MODE_ICONS[sound.defaultMode] : null;
        const row = (
          <span className={cx('flex min-w-0 flex-1 items-center gap-3', !sound && 'text-ink-3')}>
            <Thumb
              value={sound?.illustration ?? { type: 'none' }}
              fallback={FALLBACK_ICONS.sound}
              size="size-8"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] leading-5 text-ink">{name}</span>
              <span className="flex h-4 min-w-0 items-center gap-2 text-[12px] leading-4 text-ink-3">
                {ModeIcon && sound && (
                  <span className="flex min-w-0 items-center gap-1">
                    <ModeIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
                    <span className="truncate">{t(MODE_LABELS[sound.defaultMode])}</span>
                  </span>
                )}
                {sound && (
                  <span className="shrink-0 font-mono tabular-nums">
                    {duration(sound.durationSec)}
                  </span>
                )}
                {sound?.license && <LicenseBadge value={sound.license} />}
              </span>
            </span>
            {!canChoose && (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] leading-4">
                {held ? (
                  <>
                    <Check size={14} strokeWidth={1.5} aria-hidden className="text-ink-3" />
                    <span className="sr-only lg:not-sr-only">{t('mix.contents.held')}</span>
                  </>
                ) : (
                  <>
                    <Plus size={14} strokeWidth={1.5} aria-hidden className="text-ink-2" />
                    <span className="sr-only lg:not-sr-only">{t('mix.contents.new')}</span>
                  </>
                )}
              </span>
            )}
          </span>
        );
        return (
          <li key={item.soundId} className="border-t border-line first:border-t-0">
            {canChoose ? (
              <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-raised/60">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(item.soundId);
                    else next.delete(item.soundId);
                    onChosen?.(next);
                  }}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cx(
                    'flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-150',
                    on ? 'border-ink bg-ink text-deep' : 'border-line-strong bg-deep text-ink-3',
                  )}
                >
                  {on ? <Check size={14} strokeWidth={2} /> : <Minus size={14} strokeWidth={2} />}
                </span>
                {row}
              </label>
            ) : (
              <span className="flex min-h-14 items-center gap-3 px-3 py-2">{row}</span>
            )}
          </li>
        );
      })}
      {/* A sound the caller cannot see, because its owner made it private again. */}
      {mix.items.some((item) => !byId.has(item.soundId)) && (
        <li className="border-t border-line px-3 py-2 text-[13px] leading-5 text-ink-3">
          {tn('count.sounds', mix.items.length)}
        </li>
      )}
    </ul>
  );
}

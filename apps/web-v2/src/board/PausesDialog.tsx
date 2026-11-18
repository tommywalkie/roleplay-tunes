import { MAX_INTERVAL_SEC, MIN_INTERVAL_SEC, type Sound } from '@dnd/shared';
import { useState } from 'react';
import { usePlayer } from '../audio/player';
import { Dialog } from '../components/Dialog';
import { Button, cx, Field, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

const PRESETS: { label: MessageKey; min: number; max: number }[] = [
  { label: 'play.presetShort', min: 2, max: 8 },
  { label: 'play.presetMedium', min: 10, max: 30 },
  { label: 'play.presetWide', min: 5, max: 120 },
];

const clamp = (n: number) =>
  Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Number.isFinite(n) ? n : MIN_INTERVAL_SEC));

/**
 * Asks for the shortest and longest pause, then plays the sound with random pauses. The
 * fields start from the sound's own pauses unless `initial` is given; `onPlay` replaces
 * the default action, which starts the sound over with these pauses.
 */
export function PausesDialog({
  sound,
  onClose,
  initial,
  onPlay,
}: {
  sound: Sound;
  onClose: () => void;
  initial?: { min: number; max: number };
  onPlay?: (intervalMinSec: number, intervalMaxSec: number) => void;
}) {
  const { t } = useI18n();
  const player = usePlayer();
  const [min, setMin] = useState(String(initial?.min ?? sound.intervalMinSec));
  const [max, setMax] = useState(String(initial?.max ?? sound.intervalMaxSec));

  const play = () => {
    const low = clamp(Number(min));
    const high = Math.max(low, clamp(Number(max)));
    if (onPlay) onPlay(low, high);
    else player.playSoundAs(sound, { mode: 'recurring', intervalMinSec: low, intervalMaxSec: high });
    onClose();
  };

  const number = (value: string, onChange: (v: string) => void) => (id: string) => (
    <TextInput
      id={id}
      type="number"
      inputMode="numeric"
      min={MIN_INTERVAL_SEC}
      max={MAX_INTERVAL_SEC}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="font-mono tabular-nums"
    />
  );

  return (
    <Dialog
      title={`${t('play.pausesTitle')} · ${sound.name}`}
      onClose={onClose}
      onSubmit={play}
      footer={
        <>
          <Button onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary">
            {t('play.start')}
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('play.pausesHint')}</p>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('play.presets')}</span>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => {
            const on = Number(min) === preset.min && Number(max) === preset.max;
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setMin(String(preset.min));
                  setMax(String(preset.max));
                }}
                className={cx(
                  'flex min-h-14 flex-col items-center justify-center rounded-[10px] border px-2 py-2 transition-colors duration-150',
                  on ? 'border-line-strong bg-raised text-ink' : 'border-line text-ink-2 hover:bg-raised hover:text-ink',
                )}
              >
                <span className="text-[14px] leading-5">{t(preset.label)}</span>
                <span className="text-[12px] leading-4 text-ink-3 tabular-nums">
                  {preset.min}–{preset.max} s
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('sounds.gapMin')}>{number(min, setMin)}</Field>
        <Field label={t('sounds.gapMax')}>{number(max, setMax)}</Field>
      </div>
    </Dialog>
  );
}

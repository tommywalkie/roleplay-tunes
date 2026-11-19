import { Timer } from 'lucide-react';
import { useState } from 'react';
import { useSleepTimer } from '../audio/player';
import { Dialog } from '../components/Dialog';
import { Button, cx, Field, Icon, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';

const STOP_PRESETS = [15, 30, 45, 60, 90];
const FADE_PRESETS = [0, 1, 5, 10];
const MAX_MINUTES = 12 * 60;

/** A clock time such as 23:40, in the reader's language. */
export function useClock() {
  const { locale } = useI18n();
  const format = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  return (at: number) => format.format(new Date(at));
}

/**
 * The player's sleep timer row: what it is set to, and the button that opens its dialog.
 * It shows a clock time rather than a countdown, so nothing on screen ticks.
 */
export function SleepTimerRow() {
  const { t } = useI18n();
  const timer = useSleepTimer();
  const clock = useClock();
  const [open, setOpen] = useState(false);
  const label = timer.plan ? t('timer.stopsAt', { time: clock(timer.plan.stopAt) }) : t('timer.off');

  return (
    <div className="flex h-10 items-center gap-3">
      <Icon icon={Timer} className="text-ink-3" />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-2">
        {t('timer.title')}
      </span>
      <Button
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label={`${t('timer.title')}: ${label}`}
        className={cx('h-9 px-2 text-[13px]', timer.plan && 'text-ink')}
      >
        {label}
      </Button>
      {open && <SleepTimerDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A row of choices in minutes, as toggles. */
function Presets({
  values,
  value,
  onPick,
  label,
}: {
  values: number[];
  value: number;
  onPick: (n: number) => void;
  label: (n: number) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          onClick={() => onPick(n)}
          className={cx(
            'h-9 rounded-[8px] border px-3 text-[14px] leading-5 tabular-nums transition-colors duration-150',
            value === n
              ? 'border-line-strong bg-raised text-ink'
              : 'border-line text-ink-2 hover:bg-raised hover:text-ink',
          )}
        >
          {label(n)}
        </button>
      ))}
    </div>
  );
}

/**
 * Sets when everything stops, and how long it fades out before. The fade happens inside
 * the time left, so it can never run past the stop.
 */
function SleepTimerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const timer = useSleepTimer();
  const clock = useClock();
  const current = timer.plan;
  const [stopText, setStopText] = useState(() =>
    String(current ? Math.max(1, Math.round((current.stopAt - Date.now()) / 60000)) : 30),
  );
  const [fadeText, setFadeText] = useState(() =>
    String(current ? Math.round((current.stopAt - current.fadeAt) / 60000) : 5),
  );

  const stop = Math.round(Number(stopText));
  const fade = Math.round(Number(fadeText));
  const stopOk = Number.isFinite(stop) && stop >= 1 && stop <= MAX_MINUTES;
  const fadeOk = Number.isFinite(fade) && fade >= 0 && (!stopOk || fade <= stop);
  const valid = stopOk && fadeOk;

  const stopAt = Date.now() + (stopOk ? stop : 0) * 60000;
  const summary: { key: MessageKey; values: Record<string, string> } =
    fade > 0
      ? { key: 'timer.summary.fade', values: { fade: clock(stopAt - fade * 60000), stop: clock(stopAt) } }
      : { key: 'timer.summary.cut', values: { stop: clock(stopAt) } };

  const submit = () => {
    if (!valid) return;
    timer.start(stop * 60, fade * 60);
    onClose();
  };
  const minutes = (n: number) => t('timer.minutes', { n });

  const number = (value: string, onChange: (v: string) => void, max: number) => (id: string) => (
    <TextInput
      id={id}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-28 font-mono tabular-nums"
    />
  );

  return (
    <Dialog
      title={t('timer.title')}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {current && (
            <Button
              variant="danger"
              onClick={() => {
                timer.cancel();
                onClose();
              }}
              className="-ml-2 px-3"
            >
              {t('timer.turnOff')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            {t(current ? 'timer.update' : 'timer.start')}
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-5 text-ink-2">{t('timer.hint')}</p>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('timer.stopAfter')}</span>
        <Presets
          values={STOP_PRESETS}
          value={stop}
          onPick={(n) => setStopText(String(n))}
          label={minutes}
        />
        <Field label={t('timer.stopMinutes')} error={stopOk ? undefined : t('timer.stopInvalid')}>
          {number(stopText, setStopText, MAX_MINUTES)}
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] leading-5 text-ink-2">{t('timer.fadeOver')}</span>
        <Presets
          values={FADE_PRESETS}
          value={fade}
          onPick={(n) => setFadeText(String(n))}
          label={(n) => (n === 0 ? t('timer.noFade') : minutes(n))}
        />
        <Field label={t('timer.fadeMinutes')} error={fadeOk ? undefined : t('timer.fadeTooLong')}>
          {number(fadeText, setFadeText, MAX_MINUTES)}
        </Field>
      </div>

      <p className="text-[14px] leading-5 text-ink tabular-nums" role="status">
        {valid ? t(summary.key, summary.values) : ''}
      </p>
    </Dialog>
  );
}

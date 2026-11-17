import type { Sound } from '@dnd/shared';
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { LOOSE_MIX_ID, usePlayer } from '../audio/player';
import { Thumb } from '../components/Illustration';
import { useToast } from '../components/Toasts';
import { Button, cx, Fader, Icon, IconButton, Lamp, Percent } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * What plays right now, and the controls to shape it. A column on the right from tablet
 * width up; a dock above the tab bar on phones, which opens upward.
 *
 * Nothing here appears or disappears with the playback state: pause, stop all and both
 * volume faders are always rendered, always in the same place, always tappable.
 */
export function PlayerPanel({ sounds }: { sounds: Sound[] }) {
  const { t, tn } = useI18n();
  const player = usePlayer();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { snapshot } = player;
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const nameOf = (soundId: string) => byId.get(soundId)?.name ?? t('player.unknownSound');

  useEffect(
    () =>
      player.onLoadError((soundId) =>
        toast(
          t('player.loadError', {
            name: (soundId && byId.get(soundId)?.name) || t('player.unknownSound'),
          }),
          'error',
        ),
      ),
    // Names and language can change: the engine behind the player stays the same for the visit.
    [byId, t],
  );

  const layers = snapshot.mix?.layers ?? [];
  const oneshots = snapshot.activeOneshots;
  const count = layers.length + oneshots.length;
  const paused = snapshot.status === 'paused';
  const sounding = snapshot.status === 'playing' || (oneshots.length > 0 && !paused);

  const title = snapshot.mix
    ? snapshot.mix.id === LOOSE_MIX_ID
      ? t('player.custom')
      : snapshot.mix.name
    : oneshots.length > 0
      ? t('player.custom')
      : t('player.nothing');
  const status = paused
    ? t('player.paused')
    : snapshot.status === 'locked' && count > 0
      ? t('player.locked')
      : tn('count.sounds', count);

  return (
    <aside
      aria-label={t('player.title')}
      className={cx(
        'z-30 flex flex-col border-line bg-deep',
        'fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] max-h-[72dvh] border-t',
        'md:static md:h-dvh md:max-h-none md:border-l md:border-t-0',
      )}
    >
      {/* Transport: identical in every state. */}
      {/* One row on phones; from tablet width the title sits above two equal buttons. */}
      <div className="flex h-16 shrink-0 items-center gap-2 pl-4 pr-3 md:h-auto md:flex-col md:items-stretch md:gap-4 md:p-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 md:h-10 md:flex-none">
          <Lamp on={sounding} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] leading-5 font-medium" aria-live="polite">
              {title}
            </span>
            <span className="truncate text-[12px] leading-4 text-ink-3 tabular-nums">{status}</span>
          </div>
        </div>
        <IconButton
          icon={open ? ChevronDown : ChevronUp}
          label={t(open ? 'player.collapse' : 'player.expand')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="md:hidden"
        />
        <div className="flex shrink-0 gap-2">
          <Button
            icon={paused ? Play : Pause}
            aria-label={t(paused ? 'player.resume' : 'player.pause')}
            onClick={player.togglePause}
            className="w-11 px-0 md:w-auto md:flex-1 md:px-3"
          >
            <span className="hidden md:inline">{t(paused ? 'player.resume' : 'player.pause')}</span>
          </Button>
          <Button icon={Square} onClick={player.stopAll} className="px-3 md:flex-1">
            {t('player.stopAll')}
          </Button>
        </div>
      </div>

      <div
        className={cx(
          'min-h-0 flex-1 flex-col border-t border-line md:flex',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
          <VolumeRow
            icon={Volume2}
            label={t('player.master')}
            value={snapshot.masterVolume}
            onChange={player.setMasterVolume}
          />
          <VolumeRow
            icon={Zap}
            label={t('player.effects')}
            value={snapshot.effectsVolume}
            onChange={player.setEffectsVolume}
          />
        </div>

        <div className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
          <h2 className="flex items-baseline justify-between px-2 pb-2 text-[13px] leading-5 text-ink-2">
            {t('player.playing')}
            <span className="font-mono text-[12px] text-ink-3 tabular-nums">{count}</span>
          </h2>
          {count === 0 ? (
            <p className="px-2 py-6 text-[14px] leading-5 text-ink-3">{t('player.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {layers.map((layer) => {
                const name = nameOf(layer.soundId);
                const sound = byId.get(layer.soundId);
                const live = layer.load === 'ready' && !layer.muted && !paused;
                return (
                  <li key={layer.id} className="flex h-16 items-center gap-3 rounded-[10px] px-2">
                    <span className="relative">
                      <Thumb
                        value={sound?.illustration ?? { type: 'none' }}
                        fallback={AudioLines}
                        lit={live}
                      />
                      {layer.load === 'loading' && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-[8px] bg-deep/70">
                          <Icon icon={LoaderCircle} className="animate-spin text-ink-2" />
                        </span>
                      )}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span
                        className={cx(
                          'truncate text-[14px] leading-5',
                          layer.load === 'error' ? 'text-danger' : layer.muted ? 'text-ink-3' : 'text-ink',
                        )}
                      >
                        {name}
                      </span>
                      <div className="flex items-center gap-2">
                        <Fader
                          value={layer.volume}
                          onChange={(v) => player.setLayerVolume(layer.id, v)}
                          label={t('player.volumeOf', { name })}
                          lit={live}
                        />
                        <Percent value={layer.volume} />
                      </div>
                    </div>
                    <div className="flex shrink-0">
                      <IconButton
                        icon={layer.muted ? VolumeX : Volume2}
                        label={t(layer.muted ? 'player.unmute' : 'player.mute', { name })}
                        aria-pressed={layer.muted}
                        onClick={() => player.setLayerMuted(layer.id, !layer.muted)}
                        className="w-10"
                      />
                      <IconButton
                        icon={X}
                        label={t('common.removeItem', { name })}
                        onClick={() => player.removeLayer(layer.id)}
                        className="w-10"
                      />
                    </div>
                  </li>
                );
              })}
              {oneshots.map((shot) => (
                <li key={shot.id} className="flex h-16 items-center gap-3 rounded-[10px] px-2">
                  <Thumb
                    value={byId.get(shot.soundId)?.illustration ?? { type: 'none' }}
                    fallback={Zap}
                    lit={!paused}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <span className="truncate text-[14px] leading-5">{nameOf(shot.soundId)}</span>
                    <span className="block h-1 overflow-hidden rounded-[2px] bg-line-strong" aria-hidden>
                      <span
                        className="block size-full origin-left bg-lamp"
                        style={{
                          animation: `fill ${shot.durationSec}s linear both`,
                          animationDelay: `${Math.min(0, (shot.startedAt - Date.now()) / 1000)}s`,
                          animationPlayState: paused ? 'paused' : 'running',
                        }}
                      />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function VolumeRow({
  icon,
  label,
  value,
  onChange,
}: {
  icon: typeof Volume2;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex h-10 items-center gap-3" title={label}>
      <Icon icon={icon} className="text-ink-3" />
      <Fader value={value} onChange={onChange} label={label} />
      <Percent value={value} />
    </div>
  );
}

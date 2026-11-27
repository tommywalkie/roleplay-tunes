import type { Mix, Sound } from '@dnd/shared';
import {
  AudioLines,
  AudioWaveform,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  ListPlus,
  LoaderCircle,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import type { LayerState } from '@dnd/audio-engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  layerLoop,
  layersToMixItems,
  LOOSE_MIX_ID,
  playlistIdOfLayer,
  usePlayer,
  useSleepTimer,
} from '../audio/player';
import { PausesDialog } from '../board/PausesDialog';
import { LoopEditorDialog } from '../editors/LoopEditorDialog';
import { Thumb } from '../components/Illustration';
import { MODE_ICONS, MODE_LABELS } from '../components/kinds';
import { Marquee } from '../components/Marquee';
import { Menu } from '../components/Menu';
import { Popover } from '../components/Popover';
import { useToast } from '../components/Toasts';
import { Button, cx, Fader, Icon, IconButton, Lamp, Percent, useMedia } from '../components/ui';
import { useI18n } from '../i18n';
import { SleepTimerRow, useClock } from './SleepTimer';

/** Below the `lg` breakpoint the player is docked at the bottom and opens upward. */
const DOCKED = '(max-width: 1331.98px)';

/**
 * What plays right now, and the controls to shape it. A column on the right from desktop
 * width up; a dock above the tab bar on phones and tablets, which opens upward.
 *
 * Nothing here appears or disappears with the playback state: pause, stop all and both
 * volume faders are always rendered, always in the same place, always tappable.
 */
export function PlayerPanel({
  sounds,
  mixes = [],
  onSaveAsMix,
}: {
  sounds: Sound[];
  /** To name a playlist playing on top. */
  mixes?: Mix[];
  /** Opens a new mix made of what plays. Without it, the player offers no such button. */
  onSaveAsMix?: (items: ReturnType<typeof layersToMixItems>) => void;
}) {
  const { t, tn, duration } = useI18n();
  const player = usePlayer();
  const timer = useSleepTimer();
  const clock = useClock();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  // Below `lg` the player is docked and opens upward; there it stands over the page like a
  // dialog, and the page must not scroll behind it. Wider screens show it as a column,
  // always expanded.
  const docked = useMedia(DOCKED);
  const expanded = docked && open;
  const { snapshot } = player;
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const mixesById = useMemo(() => new Map(mixes.map((m) => [m.id, m])), [mixes]);
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

  useEffect(() => {
    if (!expanded) return;
    // `main` is the app's scrolling area. The player's own list is outside it, so it keeps
    // scrolling while the page behind stands still.
    const main = document.querySelector('main');
    if (!main) return;
    const previous = main.style.overflow;
    main.style.overflow = 'hidden';
    return () => {
      main.style.overflow = previous;
    };
  }, [expanded]);

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
  const base = paused
    ? t('player.paused')
    : snapshot.status === 'locked' && count > 0
      ? t('player.locked')
      : tn('count.sounds', count);
  // The timer shows on the status line too: on phones the player is usually folded away.
  const status = timer.plan
    ? `${base} ${t('timer.stopsAt', { time: clock(timer.plan.stopAt) })}`
    : base;

  return (
    <>
      {/* Docked and open, the player stands over the page: a dim layer behind it, and a tap
          on that layer closes it. */}
      {expanded && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 animate-fade bg-black/60"
        />
      )}
      <aside
        aria-label={t('player.title')}
        className={cx(
          expanded ? 'z-50' : 'z-30',
          'flex flex-col border-line bg-deep',
          'fixed inset-x-0 bottom-[calc(56px+var(--safe-bottom))] max-h-[72dvh] border-t',
          'lg:static lg:h-full lg:max-h-none lg:border-l lg:border-t-0',
        )}
      >
        {/* Transport: identical in every state. */}
        {/* One row on phones and tablets; on desktop the title sits above two equal buttons. */}
        {/* Docked at the bottom, the whole row opens and closes the player, not only the
            chevron: a tap anywhere but on a button. The chevron stays the keyboard's way. */}
        <div
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            if (docked) setOpen((v) => !v);
          }}
          className="flex h-16 shrink-0 cursor-pointer items-center gap-2 pl-4 pr-3 select-none lg:h-auto lg:cursor-auto lg:flex-col lg:items-stretch lg:gap-4 lg:p-4 lg:select-auto"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3 lg:h-10 lg:flex-none">
            <Lamp on={sounding} />
            <div className="flex min-w-0 flex-col">
              {/* What plays by name, which is the one line here long enough to be cut: a mix
                  carries across rather than ending in an ellipsis. */}
              <Marquee className="text-[15px] leading-5 font-medium" aria-live="polite">
                {title}
              </Marquee>
              <span className="truncate text-[12px] leading-4 text-ink-3 tabular-nums">{status}</span>
            </div>
          </div>
          <IconButton
            icon={open ? ChevronDown : ChevronUp}
            label={t(open ? 'player.collapse' : 'player.expand')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="lg:hidden"
          />
          <div className="flex shrink-0 gap-2">
            <Button
              icon={paused ? Play : Pause}
              aria-label={t(paused ? 'player.resume' : 'player.pause')}
              onClick={player.togglePause}
              className="w-11 px-0 lg:w-auto lg:flex-1 lg:px-3"
            >
              <span className="hidden lg:inline">{t(paused ? 'player.resume' : 'player.pause')}</span>
            </Button>
            <Button
              icon={Square}
              aria-label={t('player.stopAll')}
              onClick={player.stopAll}
              className="w-11 px-0 lg:w-auto lg:flex-1 lg:px-3"
            >
              <span className="hidden lg:inline">{t('player.stopAll')}</span>
            </Button>
          </div>
        </div>

        <div
          className={cx(
            'min-h-0 flex-1 flex-col border-t border-line lg:flex',
            open ? 'flex' : 'hidden',
          )}
        >
          <div className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
            <VolumeRow
              icon={Volume2}
              label={t('player.master')}
              note={t('player.master.hint')}
              value={snapshot.masterVolume}
              onChange={player.setMasterVolume}
            />
            <VolumeRow
              icon={Zap}
              label={t('player.effects')}
              note={t('player.effects.hint')}
              value={snapshot.effectsVolume}
              onChange={player.setEffectsVolume}
            />
            <SleepTimerRow />
          </div>

          <div className="scroll-quiet flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
            <div className="flex items-center justify-between gap-2 pb-1 pl-2">
              <h2 className="flex items-baseline gap-2 text-[13px] leading-5 text-ink-2">
                {t('player.playing')}
                <span className="font-mono text-[12px] text-ink-3 tabular-nums">{count}</span>
              </h2>
              {/* Always rendered, so the list never shifts; usable once something loops. */}
              {onSaveAsMix && (
                <Button
                  variant="ghost"
                  icon={ListPlus}
                  disabled={layers.length === 0}
                  onClick={() => onSaveAsMix(layersToMixItems(layers))}
                  className="h-9 px-2 text-[13px]"
                >
                  {t('player.saveAsMix')}
                </Button>
              )}
            </div>
            {count === 0 ? (
              <p className="px-2 py-6 text-[14px] leading-5 text-ink-3">{t('player.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {playlistsFirst(layers).map((layer) => {
                  const mode = layer.mode;
                  const sequence = mode.type === 'sequence' ? mode : null;
                  // A playlist row shows the sound being heard, under the playlist's name.
                  const heard = sequence
                    ? (sequence.items[layer.current ?? 0] ?? sequence.items[0])
                    : null;
                  const playlistName = sequence
                    ? (mixesById.get(playlistIdOfLayer(layer.id))?.name ?? t('kind.playlist'))
                    : '';
                  const soundId = heard?.soundId ?? layer.soundId;
                  const name = sequence
                    ? `${playlistName} · ${nameOf(soundId)}`
                    : nameOf(soundId);
                  const sound = byId.get(soundId);
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
                        <Marquee
                          className={cx(
                            'text-[14px] leading-5',
                            layer.load === 'error'
                              ? 'text-danger'
                              : layer.muted
                                ? 'text-ink-3'
                                : 'text-ink',
                          )}
                        >
                          {name}
                        </Marquee>
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
                        {sequence ? (
                          <PlaylistMenuButton layerId={layer.id} name={playlistName} />
                        ) : (
                          sound && <LayerModeButton layer={layer} sound={sound} name={name} />
                        )}
                        <Popover wrap label={t(layer.muted ? 'player.unmute' : 'player.mute', { name })} note={t('player.mute.hint')}>
                          <IconButton
                            icon={layer.muted ? VolumeX : Volume2}
                            label={t(layer.muted ? 'player.unmute' : 'player.mute', { name })}
                            title={undefined}
                            aria-pressed={layer.muted}
                            onClick={() => player.setLayerMuted(layer.id, !layer.muted)}
                            className="w-10"
                          />
                        </Popover>
                        <Popover wrap label={t('common.removeItem', { name })} note={t('player.remove.hint')}>
                          <IconButton
                            icon={X}
                            label={t('common.removeItem', { name })}
                            title={undefined}
                            onClick={() => player.removeLayer(layer.id)}
                            className="w-10"
                          />
                        </Popover>
                      </div>
                    </li>
                  );
                })}
                {oneshots.map((shot) => (
                  <li key={shot.id} className="flex h-16 items-center gap-3 rounded-[10px] px-2">
                    {/* Laid out like a loop row; where a loop has its fader, a "once" sound
                        says what it is. Its progress shows on its tile. */}
                    <Thumb
                      value={byId.get(shot.soundId)?.illustration ?? { type: 'none' }}
                      fallback={AudioLines}
                      lit={!paused}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Marquee className="text-[14px] leading-5">{nameOf(shot.soundId)}</Marquee>
                      <span className="flex items-center gap-1.5 text-[12px] leading-4 text-ink-3 tabular-nums">
                        <Zap size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
                        {t(MODE_LABELS.oneshot)} {duration(shot.durationSec)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Playlists first, then the rest in the order they play: a playlist over a mix is what the
 * user is most likely to reach for (next, previous). Display only; playback is unchanged.
 */
function playlistsFirst(layers: LayerState[]): LayerState[] {
  return [
    ...layers.filter((l) => l.mode.type === 'sequence'),
    ...layers.filter((l) => l.mode.type !== 'sequence'),
  ];
}

/** A playing playlist's menu: its previous and next sound. */
function PlaylistMenuButton({ layerId, name }: { layerId: string; name: string }) {
  const { t } = useI18n();
  const player = usePlayer();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setAnchor(null), []);
  const label = t('player.optionsOf', { name });

  return (
    <>
      <Popover wrap label={label} note={t('player.playlist.hint')}>
        <IconButton
          icon={Ellipsis}
          label={label}
          title={undefined}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(e.currentTarget)}
          className="w-10"
        />
      </Popover>
      {anchor && (
        <Menu
          title={name}
          anchor={anchor}
          onClose={closeMenu}
          items={[
            {
              label: t('player.previous'),
              icon: SkipBack,
              onSelect: () => player.skipPlaylist(layerId, -1),
            },
            {
              label: t('player.next'),
              icon: SkipForward,
              onSelect: () => player.skipPlaylist(layerId, 1),
            },
          ]}
        />
      )}
    </>
  );
}

/**
 * The menu of a playing sound: how it repeats (loop or random pauses), changed in place,
 * and its loop settings, live. The sound keeps its volume and its place.
 */
function LayerModeButton({ layer, sound, name }: { layer: LayerState; sound: Sound; name: string }) {
  const { t } = useI18n();
  const player = usePlayer();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [askPauses, setAskPauses] = useState(false);
  const [editLoop, setEditLoop] = useState(false);
  const closeMenu = useCallback(() => setAnchor(null), []);
  const mode = layer.mode;
  const recurring = mode.type === 'recurring';
  const label = t('player.optionsOf', { name });

  return (
    <>
      <Popover
        wrap
        label={label}
        note={t(recurring ? 'player.mode.recurring.hint' : 'player.mode.loop.hint')}
      >
        <IconButton
          icon={Ellipsis}
          label={label}
          title={undefined}
          aria-haspopup="menu"
          aria-expanded={anchor !== null}
          onClick={(e) => setAnchor(e.currentTarget)}
          className="w-10"
        />
      </Popover>
      {anchor && (
        <Menu
          title={name}
          anchor={anchor}
          onClose={closeMenu}
          items={[
            {
              label: t('play.loop'),
              icon: MODE_ICONS.loop,
              hint: recurring ? undefined : t('player.current'),
              onSelect: () => player.setLayerPlay(layer.id, sound, { mode: 'loop' }),
            },
            {
              label: t('play.randomPauses'),
              icon: MODE_ICONS.recurring,
              hint: recurring ? `${t('player.current')} ${mode.minInterval}–${mode.maxInterval} s` : undefined,
              onSelect: () => setAskPauses(true),
            },
            {
              label: t('player.loopSettings'),
              icon: AudioWaveform,
              onSelect: () => setEditLoop(true),
            },
          ]}
        />
      )}
      {editLoop && (
        <LoopEditorDialog
          sound={sound}
          mode={recurring ? 'recurring' : 'loop'}
          initial={layerLoop(sound, mode.type === 'sequence' ? undefined : mode.loop)}
          live
          onSave={(loop) => player.setLayerLoop(layer.id, loop)}
          onClose={() => setEditLoop(false)}
        />
      )}
      {askPauses && (
        <PausesDialog
          sound={sound}
          initial={recurring ? { min: mode.minInterval, max: mode.maxInterval } : undefined}
          onPlay={(intervalMinSec, intervalMaxSec) =>
            player.setLayerPlay(layer.id, sound, { mode: 'recurring', intervalMinSec, intervalMaxSec })
          }
          onClose={() => setAskPauses(false)}
        />
      )}
    </>
  );
}

function VolumeRow({
  icon,
  label,
  note,
  value,
  onChange,
}: {
  icon: typeof Volume2;
  label: string;
  note: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex h-10 items-center gap-3">
      <Popover label={label} note={note}>
        <Icon icon={icon} className="text-ink-3" />
      </Popover>
      <Fader value={value} onChange={onChange} label={label} />
      <Percent value={value} />
    </div>
  );
}

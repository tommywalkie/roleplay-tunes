import type { Mix, Scene, Sound } from '@dnd/shared';
import { Pencil, Play } from 'lucide-react';
import { useState } from 'react';
import { defaultPlay, usePlayer } from '../audio/player';
import { FALLBACK_ICONS, MODE_HINTS, MODE_ICONS, MODE_LABELS } from '../components/kinds';
import { LicenseBadge } from '../components/LicenseBadge';
import type { MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { Tile } from '../components/Tile';
import { PausesDialog } from './PausesDialog';
import { useI18n } from '../i18n';

/**
 * A sound on the board: tap to play (or to stop a loop that plays). Its corner menu plays
 * it another way than its own mode, or opens the editor.
 */
export function SoundTile({ sound, onEdit }: { sound: Sound; onEdit: () => void }) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const [askPauses, setAskPauses] = useState(false);
  const ModeIcon = MODE_ICONS[sound.defaultMode];
  // The newest run drives the bar when the same one-shot is fired several times.
  const shot = player.snapshot.activeOneshots.findLast((o) => o.soundId === sound.id);

  const menu: MenuItem[] = [
    {
      label: t('play.default'),
      hint: t('play.defaultHint', { mode: t(MODE_LABELS[sound.defaultMode]) }),
      icon: Play,
      onSelect: () => player.playSoundAs(sound, defaultPlay(sound)),
    },
    {
      label: t('play.once'),
      icon: MODE_ICONS.oneshot,
      onSelect: () => player.playSoundAs(sound, { mode: 'oneshot' }),
    },
    {
      label: t('play.loop'),
      icon: MODE_ICONS.loop,
      onSelect: () => player.playSoundAs(sound, { mode: 'loop' }),
    },
    {
      label: t('play.randomPauses'),
      icon: MODE_ICONS.recurring,
      onSelect: () => setAskPauses(true),
    },
    { label: t('common.edit'), icon: Pencil, onSelect: onEdit },
  ];

  return (
    <>
      {/* A portal: it renders in the body, so the grid keeps only list items. */}
      {askPauses && <PausesDialog sound={sound} onClose={() => setAskPauses(false)} />}
      <Tile
        menu={menu}
        name={sound.name}
        illustration={sound.illustration}
        fallback={FALLBACK_ICONS.sound}
        active={player.isSoundPlaying(sound.id)}
        progress={shot}
        onPress={() => player.toggleSound(sound)}
        editLabel={t('play.menu', { name: sound.name })}
        addedCount={sound.addedCount}
        meta={
          <>
            <Popover
              label={t(MODE_LABELS[sound.defaultMode])}
              note={
                <>
                  <span className="block font-medium text-ink">
                    {t(MODE_LABELS[sound.defaultMode])}
                  </span>
                  {t(MODE_HINTS[sound.defaultMode])}
                </>
              }
            >
              <ModeIcon size={12} strokeWidth={1.5} aria-hidden />
            </Popover>
            <span className="min-w-0 truncate">{duration(sound.durationSec)}</span>
            {sound.license && <LicenseBadge value={sound.license} size="size-3.5" />}
          </>
        }
      />
    </>
  );
}

/** A mix on the board: tap to start it in place of what plays, tap again to stop it. */
export function MixTile({ mix, onEdit }: { mix: Mix; onEdit: () => void }) {
  const { t, tn } = useI18n();
  const player = usePlayer();
  const MixIcon = FALLBACK_ICONS.mix;
  const SoundIcon = FALLBACK_ICONS.sound;
  return (
    <Tile
      name={mix.name}
      illustration={mix.illustration}
      fallback={FALLBACK_ICONS.mix}
      active={player.isMixPlaying(mix.id)}
      onPress={() => player.toggleMix(mix)}
      onEdit={onEdit}
      editLabel={t('common.editItem', { name: mix.name })}
      addedCount={mix.addedCount}
      // A mix says so, and says how many sounds it holds: the number carries its own note,
      // since the word would crowd a line that also counts who added the mix.
      meta={
        <span className="flex min-w-0 items-center gap-1.5">
          <MixIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
          {t('kind.mix')}
          <Popover label={tn('count.sounds', mix.items.length)} note={tn('count.sounds', mix.items.length)}>
            <span className="flex min-w-0 items-center gap-1.5">
              <SoundIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
              <span className="tabular-nums">{mix.items.length}</span>
            </span>
          </Popover>
        </span>
      }
    />
  );
}

/** A scene opens its own page. It is lit while one of its mixes plays. */
export function SceneTile({ scene, onEdit }: { scene: Scene; onEdit: () => void }) {
  const { t, tn } = useI18n();
  const player = usePlayer();
  const playing = player.snapshot.mix;
  const SceneIcon = FALLBACK_ICONS.scene;
  const MixIcon = FALLBACK_ICONS.mix;
  const SoundIcon = FALLBACK_ICONS.sound;
  // The counts, spelled out: the tile has room for the icons alone, the note for the words.
  const contents = `${tn('count.mixes', scene.mixIds.length)}, ${tn('count.sounds', scene.soundIds.length)}`;
  return (
    <Tile
      name={scene.name}
      illustration={scene.illustration}
      fallback={FALLBACK_ICONS.scene}
      active={playing !== null && scene.mixIds.includes(playing.id)}
      to={`/scenes/${scene.id}`}
      onEdit={onEdit}
      editLabel={t('common.editItem', { name: scene.name })}
      // A scene says so, then counts what it holds: the note hangs on the counts alone.
      meta={
        <span className="flex min-w-0 items-center gap-1.5">
          <SceneIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
          {t('kind.scene')}
          <Popover
            label={contents}
            note={
              <span className="flex flex-col gap-1 tabular-nums">
                <span className="flex items-center gap-1.5">
                  <MixIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
                  {tn('count.mixes', scene.mixIds.length)}
                </span>
                <span className="flex items-center gap-1.5">
                  <SoundIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
                  {tn('count.sounds', scene.soundIds.length)}
                </span>
              </span>
            }
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <MixIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
              {scene.mixIds.length}
              <SoundIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
              {scene.soundIds.length}
            </span>
          </Popover>
        </span>
      }
    />
  );
}

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
  return (
    <Tile
      name={mix.name}
      illustration={mix.illustration}
      fallback={FALLBACK_ICONS.mix}
      active={player.isMixPlaying(mix.id)}
      onPress={() => player.toggleMix(mix)}
      onEdit={onEdit}
      editLabel={t('common.editItem', { name: mix.name })}
      meta={<span className="truncate">{tn('count.sounds', mix.items.length)}</span>}
    />
  );
}

/** A scene opens its own page. It is lit while one of its mixes plays. */
export function SceneTile({ scene, onEdit }: { scene: Scene; onEdit: () => void }) {
  const { t, tn } = useI18n();
  const player = usePlayer();
  const playing = player.snapshot.mix;
  return (
    <Tile
      name={scene.name}
      illustration={scene.illustration}
      fallback={FALLBACK_ICONS.scene}
      active={playing !== null && scene.mixIds.includes(playing.id)}
      to={`/scenes/${scene.id}`}
      onEdit={onEdit}
      editLabel={t('common.editItem', { name: scene.name })}
      meta={
        <span className="truncate">
          {tn('count.mixes', scene.mixIds.length)} · {tn('count.sounds', scene.soundIds.length)}
        </span>
      }
    />
  );
}

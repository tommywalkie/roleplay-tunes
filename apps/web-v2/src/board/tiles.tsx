import type { Mix, Scene, Sound } from '@dnd/shared';
import { usePlayer } from '../audio/player';
import { FALLBACK_ICONS, MODE_ICONS, MODE_LABELS } from '../components/kinds';
import { Tile } from '../components/Tile';
import { useI18n } from '../i18n';

/** A sound on the board: tap to play (or to stop a loop that plays). */
export function SoundTile({ sound, onEdit }: { sound: Sound; onEdit: () => void }) {
  const { t, duration } = useI18n();
  const player = usePlayer();
  const ModeIcon = MODE_ICONS[sound.defaultMode];
  // The newest run drives the bar when the same one-shot is fired several times.
  const shot = player.snapshot.activeOneshots.findLast((o) => o.soundId === sound.id);

  return (
    <Tile
      name={sound.name}
      illustration={sound.illustration}
      fallback={FALLBACK_ICONS.sound}
      active={player.isSoundPlaying(sound.id)}
      progress={shot}
      onPress={() => player.toggleSound(sound)}
      onEdit={onEdit}
      editLabel={t('common.editItem', { name: sound.name })}
      meta={
        <>
          <ModeIcon size={12} strokeWidth={1.5} aria-hidden className="shrink-0" />
          <span className="truncate">
            {t(MODE_LABELS[sound.defaultMode])} · {duration(sound.durationSec)}
          </span>
        </>
      }
    />
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

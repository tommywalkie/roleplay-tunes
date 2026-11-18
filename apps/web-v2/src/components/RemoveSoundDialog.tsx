import type { Mix, Scene, Sound } from '@dnd/shared';
import { AlertTriangle, Layers, Map as MapIcon } from 'lucide-react';
import { useLibraryEntry } from '../api/hooks';
import { Dialog } from './Dialog';
import { FALLBACK_ICONS } from './kinds';
import { Thumb } from './Illustration';
import { Button, ErrorNote, Icon } from './ui';
import { useI18n } from '../i18n';

/** Where an added sound sits in the user's own board. */
export interface SoundUsage {
  /** Own mixes that hold it. */
  mixes: Mix[];
  /** Own scenes that hold it directly. */
  scenes: Scene[];
  /** Own scenes that hold it through one of their mixes. */
  scenesViaMix: Scene[];
  /** Added mixes that hold it: the server refuses removal while one does. */
  blockingMixes: Mix[];
}

/**
 * Where a sound the user added sits in their board, from the lists the app already holds.
 *
 * `blockingMixes` is the case the server will refuse: a mix of somebody else that the user
 * added, whose contents are not the user's to change. Everything else is their own, and
 * the sound simply comes out of it.
 */
export function soundUsage(soundId: string, board: { mixes: Mix[]; scenes: Scene[] }): SoundUsage {
  const ownMixes = board.mixes.filter((mix) => mix.access === 'owner');
  const addedMixes = board.mixes.filter((mix) => mix.access !== 'owner');
  const holds = (mix: Mix) => mix.items.some((item) => item.soundId === soundId);
  const mixes = ownMixes.filter(holds);
  const mixIdsInUse = new Set(mixes.map((mix) => mix.id));
  const blockingMixes = addedMixes.filter(holds);

  return {
    mixes,
    scenes: board.scenes.filter((scene) => scene.soundIds.includes(soundId)),
    scenesViaMix: board.scenes.filter((scene) => scene.mixIds.some((id) => mixIdsInUse.has(id))),
    blockingMixes,
  };
}

/**
 * Taking an added sound out of the library, when it is already part of the user's board.
 *
 * The server does this without asking — the sound leaves every mix and scene that holds it
 * — so the dialog exists to say that in advance: what will change, and which mix must be
 * removed first when the sound is inside one the user only borrowed.
 */
export function RemoveSoundDialog({
  sound,
  usage,
  onClose,
}: {
  sound: Sound;
  usage: SoundUsage;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const entry = useLibraryEntry('sounds');
  const blocked = usage.blockingMixes.length > 0;

  const submit = () => entry.mutate({ id: sound.id, add: false }, { onSuccess: onClose });

  return (
    <Dialog
      title={t('library.removeSound.title')}
      onClose={onClose}
      onSubmit={blocked ? undefined : submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            icon={entry.isPending ? undefined : AlertTriangle}
            busy={entry.isPending}
            disabled={entry.isPending || blocked}
          >
            {t('library.removeSound.confirm')}
          </Button>
        </>
      }
    >
      {entry.error && <ErrorNote>{errorText(entry.error)}</ErrorNote>}

      <p className="text-[14px] leading-5 text-ink-2">
        {t('library.removeSound.intro', { name: sound.name })}
      </p>

      <UsageList
        title={t('library.removeSound.inMixes', { n: usage.mixes.length })}
        items={usage.mixes.map((mix) => ({
          id: mix.id,
          name: mix.name,
          illustration: mix.illustration,
          fallback: FALLBACK_ICONS.mix,
          icon: Layers,
        }))}
      />
      <UsageList
        title={t('library.removeSound.inScenes', {
          n: usage.scenes.length + usage.scenesViaMix.length,
        })}
        items={[
          ...usage.scenes.map((scene) => ({
            id: scene.id,
            name: scene.name,
            illustration: scene.illustration,
            fallback: FALLBACK_ICONS.scene,
            icon: MapIcon,
          })),
          ...usage.scenesViaMix.map((scene) => ({
            id: `${scene.id}-via`,
            name: scene.name,
            illustration: scene.illustration,
            fallback: FALLBACK_ICONS.scene,
            icon: MapIcon,
            hint: t('library.removeSound.throughMix'),
          })),
        ]}
      />

      {blocked && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-deep px-3 py-3">
          <p className="flex items-start gap-2 text-[14px] leading-5 text-ink-2">
            <Icon icon={AlertTriangle} className="mt-0.5 text-ink-3" />
            {t('library.removeSound.blocked', { n: usage.blockingMixes.length })}
          </p>
          <ul className="flex flex-col gap-1 pl-1">
            {usage.blockingMixes.map((mix) => (
              <li key={mix.id} className="truncate text-[14px] leading-5 text-ink">
                {mix.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** One group of things the sound sits in: a heading with its count, then the items. */
function UsageList({
  title,
  items,
}: {
  title: string;
  items: {
    id: string;
    name: string;
    illustration: Sound['illustration'];
    fallback: Parameters<typeof Thumb>[0]['fallback'];
    icon: typeof Layers;
    hint?: string;
  }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[13px] leading-5 text-ink-2">{title}</h3>
      <ul className="flex flex-col overflow-hidden rounded-[12px] border border-line">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex min-h-12 items-center gap-3 border-t border-line bg-card px-3 py-2 first:border-t-0"
          >
            <Thumb value={item.illustration} fallback={item.fallback} size="size-8" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] leading-5 text-ink">{item.name}</span>
              {item.hint && (
                <span className="truncate text-[12px] leading-4 text-ink-3">{item.hint}</span>
              )}
            </span>
            <Icon icon={item.icon} className="text-ink-3" />
          </li>
        ))}
      </ul>
    </div>
  );
}

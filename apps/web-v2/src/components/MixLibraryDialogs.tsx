import { useState } from 'react';
import type { Mix, Sound } from '@dnd/shared';
import { useLibraryEntry } from '../api/hooks';
import { Dialog } from './Dialog';
import { MixContents } from './MixContents';
import { Button, ErrorNote } from './ui';
import { useI18n } from '../i18n';

/** The head of both dialogs: the mix as the library shows it, then what it holds. */
function MixSummary({
  mix,
  byId,
  heldIds,
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
  const { t, tn } = useI18n();
  const description = mix.description || t('mix.contents.noDescription');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-[14px] leading-5 text-ink-2">
          {tn('count.sounds', mix.items.length)} · {t('library.by', { name: mix.ownerName })}
        </p>
        <p className="text-[14px] leading-5 text-ink-3">{description}</p>
      </div>
      <MixContents
        mix={mix}
        byId={byId}
        heldIds={heldIds}
        selectable={selectable}
        chosen={chosen}
        onChosen={onChosen}
      />
    </div>
  );
}

/**
 * Adding a mix from the library, with what it really takes on: the mix, and every sound
 * inside it that the user does not already hold. Those sounds are added on their own too,
 * so the mix can later be removed without losing them.
 */
export function AddMixDialog({
  mix,
  byId,
  heldIds,
  onClose,
}: {
  mix: Mix;
  byId: Map<string, Sound>;
  heldIds: Set<string>;
  onClose: () => void;
}) {
  const { t, tn, errorText } = useI18n();
  const entry = useLibraryEntry('mixes');
  const sounds = useLibraryEntry('sounds');
  const pending = entry.isPending || sounds.isPending;
  const error = entry.error ?? sounds.error;
  const added = mix.items.filter((item) => heldIds.has(item.soundId));
  const fresh = mix.items.length - added.length;

  const submit = async () => {
    await entry.mutateAsync({ id: mix.id, add: true });
    // Each sound on its own, so it survives the mix. One failure does not undo the rest.
    for (const item of mix.items) {
      if (heldIds.has(item.soundId)) continue;
      try {
        await sounds.mutateAsync({ id: item.soundId, add: true });
      } catch {
        // The mix is added either way: it already gives use of its sounds.
      }
    }
    onClose();
  };

  return (
    <Dialog
      title={t('library.addMix.title')}
      onClose={onClose}
      onSubmit={pending ? undefined : submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" busy={pending} disabled={pending}>
            {t('library.addMix.confirm')}
          </Button>
        </>
      }
    >
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      <p className="text-[14px] leading-5 text-ink-2">
        {fresh === 0
          ? t('library.addMix.allHeld')
          : `${tn('library.addMix.fresh', fresh)}${
              added.length === 0 ? '.' : tn('library.addMix.held', added.length)
            }`}
      </p>
      <MixSummary mix={mix} byId={byId} heldIds={heldIds} />
    </Dialog>
  );
}

/**
 * Removing a mix the user added, and deciding what happens to the sounds it brought.
 *
 * Only a sound that no other mix or scene of theirs uses can be taken out, and only a
 * sound they do not own: their own sounds are not in the library, they are theirs. The
 * mix goes first, because the server refuses to remove a sound while a mix of the library
 * holds it; the sounds the user did not keep follow.
 */
export function RemoveMixDialog({
  mix,
  byId,
  heldIds,
  /** Sounds that may come out with the mix: added, and used nowhere else of theirs. */
  removableIds,
  onClose,
}: {
  mix: Mix;
  byId: Map<string, Sound>;
  heldIds: Set<string>;
  removableIds: Set<string>;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const entry = useLibraryEntry('mixes');
  const sounds = useLibraryEntry('sounds');
  const pending = entry.isPending || sounds.isPending;
  const error = entry.error ?? sounds.error;
  // Keeping a sound is the unusual choice: the box starts on everything that can come out.
  const [keep, setKeep] = useState<Set<string>>(() => new Set());

  const submit = async () => {
    await entry.mutateAsync({ id: mix.id, add: false });
    for (const item of mix.items) {
      if (!removableIds.has(item.soundId) || keep.has(item.soundId)) continue;
      try {
        await sounds.mutateAsync({ id: item.soundId, add: false });
      } catch {
        // The mix is gone either way; a sound that refused stays in the library.
      }
    }
    onClose();
  };

  const removable = [...removableIds];
  const dropping = removable.filter((id) => !keep.has(id));

  return (
    <Dialog
      title={t('library.removeMix.title')}
      onClose={onClose}
      onSubmit={pending ? undefined : submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="ml-auto">
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="danger"
            busy={pending}
            disabled={pending || removable.length === 0}
          >
            {t('library.removeMix.confirm')}
          </Button>
        </>
      }
    >
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      <p className="text-[14px] leading-5 text-ink-2">
        {removable.length === 0
          ? t('library.removeMix.none')
          : t('library.removeMix.summary', { n: dropping.length, total: removable.length })}
      </p>
      {removable.length > 0 && (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setKeep(new Set())}
            className="h-9 px-3 text-[13px]"
            aria-label={t('library.removeMix.dropAll')}
          >
            {t('library.removeMix.dropAll')}
          </Button>
          <Button
            onClick={() => setKeep(new Set(removable))}
            className="h-9 px-3 text-[13px]"
            aria-label={t('library.removeMix.keepAll')}
          >
            {t('library.removeMix.keepAll')}
          </Button>
        </div>
      )}
      <MixContents
        mix={mix}
        byId={byId}
        heldIds={heldIds}
        selectable={removableIds}
        // The box means "comes out with the mix", so it is the inverse of `keep`.
        chosen={new Set(removable.filter((id) => !keep.has(id)))}
        onChosen={(dropping) => setKeep(new Set(removable.filter((id) => !dropping.has(id))))}
      />
    </Dialog>
  );
}

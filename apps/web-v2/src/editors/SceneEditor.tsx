import type { Me, Mix, Scene, Sound } from '@dnd/shared';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { useDelete, useSaveScene } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import type { IllustrationDraft } from '../components/Illustration';
import { IllustrationField, illustrationChanges } from '../components/IllustrationField';
import { FALLBACK_ICONS } from '../components/kinds';
import { PickField } from '../components/PickField';
import { ErrorNote, Field, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import { EditorFooter } from './EditorFooter';

/** Creates a scene when `scene` is null, edits it otherwise. */
export function SceneEditor({
  scene,
  sounds,
  mixes,
  me,
  onClose,
  onDeleted,
}: {
  scene: Scene | null;
  sounds: Sound[];
  mixes: Mix[];
  me: Me;
  onClose: () => void;
  /** Called instead of `onClose` once the scene is gone, so its page can leave. */
  onDeleted?: () => void;
}) {
  const { t, errorText } = useI18n();
  const save = useSaveScene();
  const remove = useDelete('scenes');

  const original = scene?.illustration ?? { type: 'none' as const };
  const [name, setName] = useState(scene?.name ?? '');
  const [illustration, setIllustration] = useState<IllustrationDraft>(original);
  const [mixIds, setMixIds] = useState(scene?.mixIds ?? []);
  const [soundIds, setSoundIds] = useState(scene?.soundIds ?? []);

  const error = save.error ?? remove.error;
  const fields = error instanceof ApiError ? error.fields : undefined;

  const submit = () => {
    const { illustration: illustrationInput, image } = illustrationChanges(illustration, original);
    save.mutate(
      {
        id: scene?.id,
        body: {
          name: name.trim(),
          mixIds,
          soundIds,
          ...(illustrationInput ? { illustration: illustrationInput } : {}),
        },
        image,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title={t(scene ? 'scenes.edit' : 'scenes.new')}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <EditorFooter
          onCancel={onClose}
          onDelete={
            scene ? () => remove.mutate(scene.id, { onSuccess: onDeleted ?? onClose }) : undefined
          }
          saving={save.isPending}
          deleting={remove.isPending}
          canSave={name.trim().length > 0}
        />
      }
    >
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}

      <Field label={t('common.name')} error={fields?.name}>
        {(id) => (
          <TextInput
            id={id}
            value={name}
            maxLength={100}
            autoFocus={!scene}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>

      <IllustrationField
        value={illustration}
        onChange={setIllustration}
        fallback={FALLBACK_ICONS.scene}
        maxImageBytes={me.limits.imageFileBytes}
      />

      <PickField
        label={t('nav.mixes')}
        items={mixes}
        selected={mixIds}
        onChange={setMixIds}
        fallback={FALLBACK_ICONS.mix}
        emptyText={t('mixes.empty.title')}
      />

      <PickField
        label={t('nav.sounds')}
        items={sounds}
        selected={soundIds}
        onChange={setSoundIds}
        fallback={FALLBACK_ICONS.sound}
        emptyText={t('sounds.empty.title')}
      />
    </Dialog>
  );
}

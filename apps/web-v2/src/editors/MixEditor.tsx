import type { Me, Mix, MixItemInput, PlayMode, Scene, Sound } from '@dnd/shared';
import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { useDelete, useSaveMix } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import { Thumb, type IllustrationDraft } from '../components/Illustration';
import { IllustrationField, illustrationChanges } from '../components/IllustrationField';
import { FALLBACK_ICONS, MODE_LABELS, MODE_ORDER } from '../components/kinds';
import { PickList } from '../components/PickList';
import { ErrorNote, Fader, Field, Percent, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import { EditorFooter } from './EditorFooter';

type ItemDraft = Required<MixItemInput>;

const fromSound = (sound: Sound): ItemDraft => ({
  soundId: sound.id,
  mode: sound.defaultMode,
  volume: sound.defaultVolume,
  intervalMinSec: sound.intervalMinSec,
  intervalMaxSec: sound.intervalMaxSec,
  volumeVariation: sound.volumeVariation,
});

/** Creates a mix when `mix` is null, edits it otherwise. */
export function MixEditor({
  mix,
  sounds,
  scenes,
  me,
  onClose,
}: {
  mix: Mix | null;
  sounds: Sound[];
  scenes: Scene[];
  me: Me;
  onClose: () => void;
}) {
  const { t, errorText } = useI18n();
  const save = useSaveMix();
  const remove = useDelete('mixes');
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);

  const original = mix?.illustration ?? { type: 'none' as const };
  const [name, setName] = useState(mix?.name ?? '');
  const [illustration, setIllustration] = useState<IllustrationDraft>(original);
  const [items, setItems] = useState<ItemDraft[]>(
    () =>
      mix?.items.map(({ soundId, mode, volume, intervalMinSec, intervalMaxSec, volumeVariation }) => ({
        soundId,
        mode,
        volume,
        intervalMinSec,
        intervalMaxSec,
        volumeVariation,
      })) ?? [],
  );
  const [sceneIds, setSceneIds] = useState(mix?.sceneIds ?? []);

  const error = save.error ?? remove.error;
  const fields = error instanceof ApiError ? error.fields : undefined;

  /** Keeps the settings of sounds that stay, and gives new ones their sound's defaults. */
  const setMembers = (ids: string[]) =>
    setItems((current) =>
      ids.flatMap((id) => {
        const kept = current.find((i) => i.soundId === id);
        const sound = byId.get(id);
        return kept ? [kept] : sound ? [fromSound(sound)] : [];
      }),
    );
  const patch = (soundId: string, change: Partial<ItemDraft>) =>
    setItems((current) => current.map((i) => (i.soundId === soundId ? { ...i, ...change } : i)));

  const submit = () => {
    const { illustration: illustrationInput, image } = illustrationChanges(illustration, original);
    save.mutate(
      {
        id: mix?.id,
        body: {
          name: name.trim(),
          items,
          sceneIds,
          ...(illustrationInput ? { illustration: illustrationInput } : {}),
        },
        image,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title={t(mix ? 'mixes.edit' : 'mixes.new')}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <EditorFooter
          onCancel={onClose}
          onDelete={mix ? () => remove.mutate(mix.id, { onSuccess: onClose }) : undefined}
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
            autoFocus={!mix}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>

      <IllustrationField
        value={illustration}
        onChange={setIllustration}
        fallback={FALLBACK_ICONS.mix}
        maxImageBytes={me.limits.imageFileBytes}
      />

      <div className="flex flex-col gap-2">
        <PickList
          label={t('mixes.sounds')}
          items={sounds}
          selected={items.map((i) => i.soundId)}
          onChange={setMembers}
          fallback={FALLBACK_ICONS.sound}
          emptyText={t('sounds.empty.title')}
          max={me.limits.mixItems}
        />
        <p className="text-[13px] leading-5 text-ink-3">
          {t('mixes.limit', { n: me.limits.mixItems })}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const sound = byId.get(item.soundId);
            const label = sound?.name ?? t('player.unknownSound');
            return (
              <li key={item.soundId} className="flex min-h-16 items-center gap-3">
                <Thumb value={sound?.illustration ?? { type: 'none' }} fallback={FALLBACK_ICONS.sound} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[14px] leading-5">{label}</span>
                  <div className="flex items-center gap-2">
                    <Fader
                      value={item.volume}
                      onChange={(volume) => patch(item.soundId, { volume })}
                      label={t('player.volumeOf', { name: label })}
                    />
                    <Percent value={item.volume} />
                  </div>
                </div>
                <select
                  value={item.mode}
                  onChange={(e) => patch(item.soundId, { mode: e.target.value as PlayMode })}
                  aria-label={`${t('sounds.playMode')}: ${label}`}
                  className="h-11 w-32 shrink-0 rounded-[10px] border border-line bg-raised px-2 text-[14px] text-ink"
                >
                  {MODE_ORDER.map((m) => (
                    <option key={m} value={m}>
                      {t(MODE_LABELS[m])}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}

      <PickList
        label={t('sounds.inScenes')}
        items={scenes}
        selected={sceneIds}
        onChange={setSceneIds}
        fallback={FALLBACK_ICONS.scene}
        emptyText={t('sounds.noScenes')}
      />
    </Dialog>
  );
}

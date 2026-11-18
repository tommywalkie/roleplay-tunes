import { DESCRIPTION_MAX, MAX_INTERVAL_SEC, MIN_INTERVAL_SEC, type Me, type Mix, type MixItemInput, type PlayMode, type Scene, type Sound } from '@dnd/shared';
import { useMemo, useState } from 'react';
import { ApiError } from '../api/client';
import { useDelete, useLibraryEntry, useSaveMix, useSetMixVolumes } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import { Thumb, type IllustrationDraft } from '../components/Illustration';
import { IllustrationField, illustrationChanges } from '../components/IllustrationField';
import { FALLBACK_ICONS, MODE_LABELS, MODE_ORDER } from '../components/kinds';
import { PickField } from '../components/PickField';
import { PickList } from '../components/PickList';
import { ErrorNote, Fader, Field, Percent, Select, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import { EditorFooter } from './EditorFooter';
import { OwnerNote, OwnerOnly, TextArea, VisibilityField } from './Sharing';

export type ItemDraft = Required<MixItemInput>;

const clampPause = (n: number) =>
  Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Number.isFinite(n) ? n : MIN_INTERVAL_SEC));

/** A pause bound in seconds. Kept as typed while editing; clamped when the mix is saved. */
function PauseInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field label={label}>
      {(id) => (
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          min={MIN_INTERVAL_SEC}
          max={MAX_INTERVAL_SEC}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onChange(Number(e.target.value));
          }}
          className="font-mono tabular-nums disabled:opacity-45"
        />
      )}
    </Field>
  );
}

const fromSound = (sound: Sound): ItemDraft => ({
  soundId: sound.id,
  mode: sound.defaultMode,
  volume: sound.defaultVolume,
  intervalMinSec: sound.intervalMinSec,
  intervalMaxSec: sound.intervalMaxSec,
  volumeVariation: sound.volumeVariation,
});

/**
 * Creates a mix when `mix` is null, edits it otherwise. For a mix added from the library,
 * only the user's own volumes and scenes stay editable.
 */
export function MixEditor({
  mix,
  sounds,
  scenes,
  me,
  onClose,
  initialItems,
}: {
  mix: Mix | null;
  sounds: Sound[];
  scenes: Scene[];
  me: Me;
  onClose: () => void;
  /** Sounds a new mix starts with, such as what the player plays. */
  initialItems?: ItemDraft[];
}) {
  const { t, errorText } = useI18n();
  const save = useSaveMix();
  const setVolumes = useSetMixVolumes();
  const remove = useDelete('mixes');
  const unlink = useLibraryEntry('mixes');
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const owned = !mix || mix.access === 'owner';

  const original = mix?.illustration ?? { type: 'none' as const };
  const [name, setName] = useState(mix?.name ?? '');
  const [description, setDescription] = useState(mix?.description ?? '');
  const [isPublic, setIsPublic] = useState(mix?.isPublic ?? false);
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
      })) ??
      initialItems ??
      [],
  );
  const [sceneIds, setSceneIds] = useState(mix?.sceneIds ?? []);

  const error = save.error ?? setVolumes.error ?? remove.error ?? unlink.error;
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
    if (mix && !owned) {
      const volumes = Object.fromEntries(items.map((i) => [i.soundId, i.volume]));
      setVolumes.mutate(
        { id: mix.id, volumes },
        {
          onSuccess: () =>
            save.mutate({ id: mix.id, body: { sceneIds }, image: null }, { onSuccess: onClose }),
        },
      );
      return;
    }
    const { illustration: illustrationInput, image } = illustrationChanges(illustration, original);
    save.mutate(
      {
        id: mix?.id,
        body: {
          name: name.trim(),
          description,
          isPublic,
          items: items.map((item) => {
            const min = clampPause(item.intervalMinSec);
            return { ...item, intervalMinSec: min, intervalMaxSec: Math.max(min, clampPause(item.intervalMaxSec)) };
          }),
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
        owned ? (
          <EditorFooter
            onCancel={onClose}
            onDelete={mix ? () => remove.mutate(mix.id, { onSuccess: onClose }) : undefined}
            saving={save.isPending}
            deleting={remove.isPending}
            canSave={name.trim().length > 0}
          />
        ) : (
          <EditorFooter
            onCancel={onClose}
            onDelete={() => unlink.mutate({ id: mix.id, add: false }, { onSuccess: onClose })}
            deleteLabel={t('share.remove')}
            confirmText={t('share.confirmRemove')}
            saving={save.isPending || setVolumes.isPending}
            deleting={unlink.isPending}
          />
        )
      }
    >
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}

      {mix && !owned && <OwnerNote name={mix.ownerName} />}

      <OwnerOnly locked={!owned}>
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

        <TextArea
          label={t('common.description')}
          value={description}
          onChange={setDescription}
          maxLength={DESCRIPTION_MAX}
          error={fields?.description}
        />

        <VisibilityField
          value={isPublic}
          onChange={setIsPublic}
          note={t('share.mixPublicHint')}
          error={fields?.isPublic}
        />

        <IllustrationField
          value={illustration}
          onChange={setIllustration}
          fallback={FALLBACK_ICONS.mix}
          maxImageBytes={me.limits.imageFileBytes}
        />

        <div className="flex flex-col gap-2">
          <PickField
            label={t('mixes.sounds')}
            items={sounds}
            selected={items.map((i) => i.soundId)}
            onChange={setMembers}
            fallback={FALLBACK_ICONS.sound}
            emptyText={t('sounds.empty.title')}
            max={me.limits.mixItems}
          />
          <p className={fields?.items ? 'text-[13px] leading-5 text-danger' : 'text-[13px] leading-5 text-ink-3'}>
            {fields?.items ?? t('mixes.limit', { n: me.limits.mixItems })}
          </p>
        </div>
      </OwnerOnly>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          {!owned && <p className="text-[13px] leading-5 text-ink-3">{t('share.yourVolume')}</p>}
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const sound = byId.get(item.soundId);
              const label = sound?.name ?? t('player.unknownSound');
              return (
                <li key={item.soundId} className="flex flex-col gap-2 py-1">
                  <div className="flex min-h-16 items-center gap-3">
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
                  <Select
                    value={item.mode}
                    disabled={!owned}
                    onChange={(e) => patch(item.soundId, { mode: e.target.value as PlayMode })}
                    aria-label={`${t('sounds.playMode')}: ${label}`}
                    className="w-40 shrink-0 pr-8 text-[14px] disabled:opacity-45 sm:w-48"
                  >
                    {MODE_ORDER.map((m) => (
                      <option key={m} value={m}>
                        {t(MODE_LABELS[m])}
                      </option>
                    ))}
                  </Select>
                  </div>
                  {item.mode === 'recurring' && (
                    // Under the name, past the thumbnail: the pauses belong to this sound.
                    <div className="grid grid-cols-2 gap-3 pl-[52px]">
                      <PauseInput
                        label={t('sounds.gapMin')}
                        value={item.intervalMinSec}
                        disabled={!owned}
                        onChange={(intervalMinSec) => patch(item.soundId, { intervalMinSec })}
                      />
                      <PauseInput
                        label={t('sounds.gapMax')}
                        value={item.intervalMaxSec}
                        disabled={!owned}
                        onChange={(intervalMaxSec) => patch(item.soundId, { intervalMaxSec })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
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

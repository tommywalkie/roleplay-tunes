import {
  DEFAULT_CROSSFADE_SEC,
  DESCRIPTION_MAX,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC,
  SOUND_META_MAX,
  type LoopSettings,
  type Me,
  type PlayMode,
  type Scene,
  type Sound,
  type UpdateSoundRequest,
} from '@dnd/shared';
import { AudioWaveform } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { useDelete, useLibraryEntry, useSaveSound } from '../api/hooks';
import { soundLoop } from '../audio/player';
import { Dialog } from '../components/Dialog';
import { Disclosure } from '../components/Disclosure';
import type { IllustrationDraft } from '../components/Illustration';
import { IllustrationField, illustrationChanges } from '../components/IllustrationField';
import { FALLBACK_ICONS, MODE_ICONS, MODE_LABELS, MODE_ORDER } from '../components/kinds';
import { PickField } from '../components/PickField';
import { SOUND_DETAILS, type SoundMetaKey } from '../components/SoundDetails';
import { Button, ErrorNote, Fader, Field, Percent, Segmented, TextInput } from '../components/ui';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { EditorFooter } from './EditorFooter';
import { LicenseField } from './LicenseField';
import { LoopEditorDialog } from './LoopEditorDialog';
import { TagFields, useTagsDraft } from './TagFields';
import { OwnerNote, OwnerOnly, TextArea, VisibilityField } from './Sharing';

const clampInterval = (n: number) =>
  Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Number.isFinite(n) ? n : MIN_INTERVAL_SEC));

/**
 * Edits a sound. For a sound added from the library, everything but the user's own volume
 * and scenes is greyed out, and the footer removes it from the library instead of deleting.
 */
export function SoundEditor({
  sound,
  scenes,
  me,
  onClose,
}: {
  sound: Sound;
  scenes: Scene[];
  me: Me;
  onClose: () => void;
}) {
  const { t, errorText, duration } = useI18n();
  const save = useSaveSound();
  const remove = useDelete('sounds');
  const unlink = useLibraryEntry('sounds');
  const owned = sound.access === 'owner';

  const [name, setName] = useState(sound.name);
  // One entry per detail field — what the sound is from — keyed so that the editor and the
  // library card share the same list of fields and their icons.
  const [meta, setMeta] = useState<Record<SoundMetaKey, string>>({
    artists: sound.artists ?? '',
    year: sound.year ?? '',
    movie: sound.movie ?? '',
    game: sound.game ?? '',
    tv: sound.tv ?? '',
    album: sound.album ?? '',
    url: sound.url ?? '',
  });
  const setMetaField = (key: SoundMetaKey, value: string) =>
    setMeta((written) => ({ ...written, [key]: value }));
  const [description, setDescription] = useState(sound.description ?? '');
  const [license, setLicense] = useState(sound.license ?? '');
  const [isPublic, setIsPublic] = useState(sound.isPublic);
  const [illustration, setIllustration] = useState<IllustrationDraft>(sound.illustration);
  const [mode, setMode] = useState<PlayMode>(sound.defaultMode);
  const [volume, setVolume] = useState(sound.defaultVolume);
  const [gapMin, setGapMin] = useState(String(sound.intervalMinSec));
  const [gapMax, setGapMax] = useState(String(sound.intervalMaxSec));
  const [variation, setVariation] = useState(sound.volumeVariation);
  const [sceneIds, setSceneIds] = useState(sound.sceneIds);
  const [loop, setLoop] = useState<LoopSettings>(() => soundLoop(sound));
  const [loopOpen, setLoopOpen] = useState(false);
  const tags = useTagsDraft(sound);

  const error = save.error ?? remove.error ?? unlink.error;
  const fields = error instanceof ApiError ? error.fields : undefined;

  // A marker at its usual edge is stored as null ("the default"), not as a number.
  const loopBody = {
    trackStartSec: loop.trackStartSec > 0 ? loop.trackStartSec : null,
    trackEndSec: loop.trackEndSec < sound.durationSec ? loop.trackEndSec : null,
    loopStartSec: loop.loopStartSec > loop.trackStartSec ? loop.loopStartSec : null,
    loopEndSec: loop.loopEndSec < loop.trackEndSec ? loop.loopEndSec : null,
    loopMode: loop.loopMode,
    crossfadeSec:
      loop.crossfadeSec === Math.min(DEFAULT_CROSSFADE_SEC, (loop.loopEndSec - loop.loopStartSec) / 2)
        ? null
        : loop.crossfadeSec,
  };

  const submit = () => {
    if (!owned) {
      // Their own loop settings, sent only once they changed them: the owner's stay untouched.
      const initial = soundLoop(sound);
      const loopChanged = (Object.keys(initial) as (keyof LoopSettings)[]).some(
        (key) => initial[key] !== loop[key],
      );
      save.mutate(
        {
          id: sound.id,
          body: {
            defaultVolume: volume,
            sceneIds,
            ...tags.body,
            ...(loopChanged ? loopBody : {}),
          },
        },
        { onSuccess: onClose },
      );
      return;
    }
    const min = clampInterval(Number(gapMin));
    const max = Math.max(min, clampInterval(Number(gapMax)));
    const { illustration: illustrationInput, image } = illustrationChanges(
      illustration,
      sound.illustration,
    );
    const body: UpdateSoundRequest = {
      name: name.trim(),
      description,
      license,
      ...meta,
      isPublic,
      defaultMode: mode,
      defaultVolume: volume,
      ...loopBody,
      intervalMinSec: min,
      intervalMaxSec: max,
      volumeVariation: variation,
      sceneIds,
      ...tags.body,
      ...(illustrationInput ? { illustration: illustrationInput } : {}),
    };
    save.mutate({ id: sound.id, body, image }, { onSuccess: onClose });
  };

  return (
    <>
      <Dialog
        title={t('sounds.edit')}
        onClose={onClose}
        onSubmit={submit}
      footer={
        owned ? (
          <EditorFooter
            onCancel={onClose}
            onDelete={() => remove.mutate(sound.id, { onSuccess: onClose })}
            saving={save.isPending}
            deleting={remove.isPending}
            canSave={name.trim().length > 0}
          />
        ) : (
          <EditorFooter
            onCancel={onClose}
            onDelete={() => unlink.mutate({ id: sound.id, add: false }, { onSuccess: onClose })}
            deleteLabel={t('share.remove')}
            confirmText={t('share.confirmRemove')}
            saving={save.isPending}
            deleting={unlink.isPending}
          />
        )
      }
    >
      {error && (
        <ErrorNote>
          {errorText(error)}
          {fields?.sound ? `. ${fields.sound}` : ''}
        </ErrorNote>
      )}

      {!owned && <OwnerNote name={sound.ownerName} />}

      <OwnerOnly locked={!owned}>
        <Field label={t('common.name')} error={fields?.name}>
          {(id) => (
            <TextInput id={id} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>

        <Disclosure title={t('sounds.moreDetails')}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {SOUND_DETAILS.map(({ key, label }) => (
              <Field key={key} label={t(label)} error={fields?.[key]}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={meta[key]}
                    maxLength={SOUND_META_MAX}
                    inputMode={key === 'url' ? 'url' : undefined}
                    onChange={(e) => setMetaField(key, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>

          <TextArea
            label={t('common.description')}
            value={description}
            onChange={setDescription}
            maxLength={DESCRIPTION_MAX}
            error={fields?.description}
          />
        </Disclosure>

        <LicenseField value={license} onChange={setLicense} error={fields?.license} />

        <VisibilityField value={isPublic} onChange={setIsPublic} error={fields?.isPublic} />

        <IllustrationField
          value={illustration}
          onChange={setIllustration}
          fallback={FALLBACK_ICONS.sound}
          maxImageBytes={me.limits.imageFileBytes}
        />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] leading-5 text-ink-2">{t('sounds.playMode')}</span>
          <Segmented
            label={t('sounds.playMode')}
            value={mode}
            onChange={setMode}
            options={MODE_ORDER.map((m) => ({
              value: m,
              label: t(MODE_LABELS[m]),
              icon: MODE_ICONS[m],
            }))}
          />
          <p className="text-[13px] leading-5 text-ink-3">{t(`mode.${mode}.hint` as MessageKey)}</p>
        </div>
      </OwnerOnly>

      {/* Anyone may set the loop: the owner sets the sound's own, others their own copy. */}
      <Field label={t('loop.label')} hint={owned ? undefined : t('share.yourLoop')}>
          {() => (
            <div className="flex items-center gap-3">
              <Button icon={AudioWaveform} onClick={() => setLoopOpen(true)}>
                {t('loop.edit')}
              </Button>
              <span className="min-w-0 truncate font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
                {loop.trackStartSec <= 0 &&
                loop.trackEndSec >= sound.durationSec &&
                loop.loopStartSec <= loop.trackStartSec &&
                loop.loopEndSec >= loop.trackEndSec &&
                loop.loopMode === 'gapless'
                  ? t('loop.wholeTrack')
                  : t('loop.summary', {
                      from: duration(loop.loopStartSec),
                      to: duration(loop.loopEndSec),
                      mode:
                        loop.loopMode === 'crossfade'
                          ? ` · ${t('loop.mode.crossfade')} ${loop.crossfadeSec.toFixed(1)} s`
                          : '',
                    })}
              </span>
            </div>
          )}
        </Field>

      <OwnerOnly locked={!owned}>
        {mode === 'recurring' && (
          <div className="grid grid-cols-2 gap-4">
            <Field label={t('sounds.gapMin')} error={fields?.intervalMinSec}>
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={MIN_INTERVAL_SEC}
                  max={MAX_INTERVAL_SEC}
                  value={gapMin}
                  onChange={(e) => setGapMin(e.target.value)}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
            <Field label={t('sounds.gapMax')} error={fields?.intervalMaxSec}>
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={MIN_INTERVAL_SEC}
                  max={MAX_INTERVAL_SEC}
                  value={gapMax}
                  onChange={(e) => setGapMax(e.target.value)}
                  className="font-mono tabular-nums"
                />
              )}
            </Field>
          </div>
        )}
      </OwnerOnly>

      <TagFields draft={tags} ownerName={owned ? undefined : sound.ownerName} errors={fields} />

      <Field label={t('sounds.volume')} hint={owned ? undefined : t('share.yourVolume')}>
        {(id) => (
          <div className="flex items-center gap-3">
            <Fader id={id} value={volume} onChange={setVolume} label={t('sounds.volume')} />
            <Percent value={volume} />
          </div>
        )}
      </Field>

      {mode === 'recurring' && (
        <OwnerOnly locked={!owned}>
          <Field label={t('sounds.variation')}>
            {(id) => (
              <div className="flex items-center gap-3">
                <Fader id={id} value={variation} onChange={setVariation} label={t('sounds.variation')} />
                <Percent value={variation} />
              </div>
            )}
          </Field>
        </OwnerOnly>
      )}

      <PickField
        label={t('sounds.inScenes')}
        items={scenes}
        selected={sceneIds}
        onChange={setSceneIds}
        fallback={FALLBACK_ICONS.scene}
        emptyText={t('sounds.noScenes')}
      />
      </Dialog>

      {loopOpen && (
        <LoopEditorDialog
          sound={sound}
          mode={mode}
          initial={loop}
          onSave={setLoop}
          onClose={() => setLoopOpen(false)}
        />
      )}
    </>
  );
}

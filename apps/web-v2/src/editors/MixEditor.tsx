import {
  DEFAULT_VOLUME,
  DESCRIPTION_MAX,
  MAX_CROSSFADE_SEC,
  MAX_INTERVAL_SEC,
  MIN_INTERVAL_SEC,
  type LoopSettings,
  type Me,
  type Mix,
  type MixItemInput,
  type MixKind,
  type MixPlaylist,
  type PlayMode,
  type Scene,
  type Sound,
  type UpdateMixRequest,
  type UpdateSoundRequest,
} from '@dnd/shared';
import { AudioWaveform, ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { ApiError } from '../api/client';
import {
  useDelete,
  useLibraryEntry,
  useSaveMix,
  useSaveSound,
  useSetMixVolumes,
} from '../api/hooks';
import { itemLoop, soundLoop } from '../audio/player';
import { Dialog } from '../components/Dialog';
import { Thumb, type IllustrationDraft } from '../components/Illustration';
import { IllustrationField, illustrationChanges } from '../components/IllustrationField';
import { FALLBACK_ICONS, MODE_LABELS, MODE_ORDER } from '../components/kinds';
import { PickField } from '../components/PickField';
import {
  Button,
  ErrorNote,
  Fader,
  Field,
  IconButton,
  Percent,
  Select,
  TextInput,
} from '../components/ui';
import { useI18n } from '../i18n';
import { EditorFooter } from './EditorFooter';
import { LoopEditorDialog } from './LoopEditorDialog';
import { TagFields, useTagsDraft } from './TagFields';
import { OwnerNote, OwnerOnly, TextArea, UnpublishDialog, VisibilityField } from './Sharing';

export type ItemDraft = Required<MixItemInput>;

/** Length of each sound in the crossfade preview, in seconds: twice the longest crossfade. */
const PREVIEW_SOUND_SEC = 2 * MAX_CROSSFADE_SEC;
/** Bars per second in the preview's fake waveforms. */
const PREVIEW_BARS_PER_SEC = 2;

/** A fixed, made-up waveform: bar heights between 0.25 and 1, the same on every render. */
const fakePeak = (i: number, seed: number) =>
  0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + seed) * Math.cos(i * 0.6 + seed * 2));

/**
 * Two made-up sounds of a playlist, one after the other, overlapping by the crossfade: the
 * first fades out while the second fades in (equal power, as played), with their volume
 * lines drawn over the bars. At 0 they meet back to back.
 */
function CrossfadePreview({ crossfadeSec }: { crossfadeSec: number }) {
  const { t } = useI18n();
  const cf = Math.min(Math.max(crossfadeSec, 0), PREVIEW_SOUND_SEC / 2);
  const span = 2 * PREVIEW_SOUND_SEC - cf;
  const height = 48;
  const mid = height / 2;
  const bStart = PREVIEW_SOUND_SEC - cf;
  /** Gain of the first sound at time x: full, then fading out over the crossfade. */
  const gainA = (x: number) =>
    x <= bStart ? 1 : x >= PREVIEW_SOUND_SEC ? 0 : Math.cos(((x - bStart) / cf) * (Math.PI / 2));
  /** Gain of the second sound at time x: fading in over the crossfade, then full. */
  const gainB = (x: number) =>
    x <= bStart ? 0 : x >= PREVIEW_SOUND_SEC ? 1 : Math.sin(((x - bStart) / cf) * (Math.PI / 2));
  const step = 1 / PREVIEW_BARS_PER_SEC;
  const bars = (from: number, seed: number, gain: (x: number) => number) =>
    Array.from({ length: PREVIEW_SOUND_SEC * PREVIEW_BARS_PER_SEC }, (_, i) => {
      const x = from + i * step;
      const h = fakePeak(i, seed) * gain(x + step / 2) * (height - 8);
      return { x, h };
    });
  const line = (gain: (x: number) => number, from: number, to: number) => {
    const points: string[] = [];
    for (let x = from; x <= to + 1e-9; x += 0.1) {
      points.push(`${x.toFixed(2)},${(height - 2 - gain(x) * (height - 4)).toFixed(2)}`);
    }
    return points.join(' ');
  };

  return (
    <svg
      viewBox={`0 0 ${span} ${height}`}
      preserveAspectRatio="none"
      className="h-12 w-full rounded-[8px] bg-deep"
      role="img"
      aria-label={t('mixes.playlistCrossfadePreview', { n: cf.toFixed(1) })}
    >
      {bars(0, 1, gainA).map(({ x, h }) => (
        <rect
          key={`a${x}`}
          x={x}
          y={mid - h / 2}
          width={step * 0.5}
          height={Math.max(0.5, h)}
          className="fill-ink-2"
        />
      ))}
      {bars(bStart, 4, gainB).map(({ x, h }) => (
        <rect
          key={`b${x}`}
          x={x + step * 0.5}
          y={mid - h / 2}
          width={step * 0.5}
          height={Math.max(0.5, h)}
          className="fill-ink-3"
        />
      ))}
      <polyline
        points={line(gainA, 0, PREVIEW_SOUND_SEC)}
        fill="none"
        className="stroke-ink"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={line(gainB, bStart, span)}
        fill="none"
        className="stroke-ink-2"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

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
  // No override: the item follows the sound's own loop settings.
  trackStartSec: null,
  trackEndSec: null,
  loopStartSec: null,
  loopEndSec: null,
  crossfadeSec: null,
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
  kind: newKind = 'mix',
  mixes: available = [],
}: {
  mix: Mix | null;
  /** The user's mixes and playlists: the playlists among them can go in a mix. */
  mixes?: Mix[];
  /** For a new one: a mix (sounds together) or a playlist (one after another). */
  kind?: MixKind;
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
  const publish = useSaveSound();
  const publishPlaylist = useSaveMix();
  const byId = useMemo(() => new Map(sounds.map((s) => [s.id, s])), [sounds]);
  const owned = !mix || mix.access === 'owner';
  const kind = mix?.kind ?? newKind;
  const playlist = kind === 'playlist';

  const original = mix?.illustration ?? { type: 'none' as const };
  const [name, setName] = useState(mix?.name ?? '');
  const [description, setDescription] = useState(mix?.description ?? '');
  const [isPublic, setIsPublic] = useState(mix?.isPublic ?? false);
  /** A playlist's crossfade between its sounds, the last into the first too; 0 = back to back. */
  const [crossfade, setCrossfade] = useState(mix?.crossfadeSec ?? 0);
  const [illustration, setIllustration] = useState<IllustrationDraft>(original);
  const [items, setItems] = useState<ItemDraft[]>(
    () =>
      mix?.items.map((item) => ({
        soundId: item.soundId,
        mode: item.mode,
        volume: item.volume,
        intervalMinSec: item.intervalMinSec,
        intervalMaxSec: item.intervalMaxSec,
        volumeVariation: item.volumeVariation,
        trackStartSec: item.trackStartSec,
        trackEndSec: item.trackEndSec,
        loopStartSec: item.loopStartSec,
        loopEndSec: item.loopEndSec,
        crossfadeSec: item.crossfadeSec,
      })) ??
      initialItems ??
      [],
  );
  const [sceneIds, setSceneIds] = useState(mix?.sceneIds ?? []);
  /** Playlists the mix holds, with their volume. */
  const [held, setHeld] = useState<MixPlaylist[]>(mix?.playlists ?? []);
  /** Playlists the user can put in this mix: any of theirs, never this one. */
  const playlists = useMemo(
    () => available.filter((m) => m.kind === 'playlist' && m.id !== mix?.id),
    [available, mix?.id],
  );
  /** The sound whose loop is being edited in the nested dialog, by sound id. */
  const [loopFor, setLoopFor] = useState<string | null>(null);
  const tags = useTagsDraft(mix);

  const error = save.error ?? setVolumes.error ?? remove.error ?? unlink.error;
  const fields = error instanceof ApiError ? error.fields : undefined;

  /**
   * A public mix may only hold public sounds, so publishing one that still holds private
   * sounds has to make those public first. The mix is not saved until the user says so:
   * the server would refuse it either way, and a refusal after a click is a worse answer
   * than a question before it.
   */
  const [publishing, setPublishing] = useState(false);
  /**
   * Turning a public mix or playlist private: a dialog says first what it is taken out of.
   * A playlist leaves the user's public mixes that hold it (they stay public), and either
   * leaves the library of everyone who added it. Confirming only saves it.
   */
  const [unpublishing, setUnpublishing] = useState(false);
  const turningPrivate = !!mix && mix.isPublic && !isPublic;
  const holdingMixes = useMemo(
    () =>
      playlist && turningPrivate && mix
        ? available.filter(
            (m) =>
              m.access === 'owner' &&
              m.isPublic &&
              m.playlists.some((p) => p.playlistId === mix.id),
          )
        : [],
    [playlist, turningPrivate, mix, available],
  );
  /** Private playlists the mix holds: a public mix holds public playlists only. */
  const privatePlaylists = useMemo(
    () =>
      playlist
        ? []
        : held
            .map((entry) => available.find((m) => m.id === entry.playlistId))
            .filter((m): m is Mix => m !== undefined && !m.isPublic),
    [playlist, held, available],
  );
  /**
   * Private sounds that must turn public with the mix: its own, and those of the private
   * playlists it holds, since a public playlist holds public sounds only. Each once.
   */
  const privateMembers = useMemo(() => {
    const ids = [
      ...items.map((item) => item.soundId),
      ...privatePlaylists.flatMap((p) => p.items.map((item) => item.soundId)),
    ];
    return [...new Set(ids)]
      .map((id) => byId.get(id))
      .filter((sound): sound is Sound => sound !== undefined && !sound.isPublic);
  }, [items, privatePlaylists, byId]);

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
  /** Moves an item up (-1) or down (1): a playlist plays in this order. */
  const move = (index: number, delta: number) =>
    setItems((current) => {
      const to = index + delta;
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  /**
   * Saves one item's loop settings as overrides: a value equal to the sound's own resolved
   * setting goes back to null ("follow the sound"), so the sound's defaults are never
   * mutated and two mixes can loop the same sound differently.
   */
  const saveItemLoop = (soundId: string, loop: LoopSettings) => {
    const sound = byId.get(soundId);
    const base = sound ? soundLoop(sound) : loop;
    const trackStartSec = loop.trackStartSec !== base.trackStartSec ? loop.trackStartSec : null;
    const trackEndSec = loop.trackEndSec !== base.trackEndSec ? loop.trackEndSec : null;
    // A playlist plays each sound once: only its track range is kept.
    if (playlist) {
      patch(soundId, {
        trackStartSec,
        trackEndSec,
        loopStartSec: null,
        loopEndSec: null,
        crossfadeSec: null,
      });
      return;
    }
    patch(soundId, {
      trackStartSec,
      trackEndSec,
      loopStartSec: loop.loopStartSec !== base.loopStartSec ? loop.loopStartSec : null,
      loopEndSec: loop.loopEndSec !== base.loopEndSec ? loop.loopEndSec : null,
      crossfadeSec: loop.crossfadeSec !== base.crossfadeSec ? loop.crossfadeSec : null,
    });
  };

  const submit = () => {
    if (mix && !owned) {
      const volumes = Object.fromEntries(items.map((i) => [i.soundId, i.volume]));
      setVolumes.mutate(
        { id: mix.id, volumes },
        {
          onSuccess: () =>
            save.mutate(
              { id: mix.id, body: { sceneIds, ...tags.body }, image: null },
              { onSuccess: onClose },
            ),
        },
      );
      return;
    }
    if (owned && isPublic && privateMembers.length + privatePlaylists.length > 0) {
      setPublishing(true);
      return;
    }
    if (owned && turningPrivate && (holdingMixes.length > 0 || (mix?.addedCount ?? 0) > 0)) {
      setUnpublishing(true);
      return;
    }
    saveMix();
  };

  const saveMix = () => {
    const { illustration: illustrationInput, image } = illustrationChanges(illustration, original);
    save.mutate(
      {
        id: mix?.id,
        body: {
          name: name.trim(),
          description,
          isPublic,
          // The kind is set once, when it is created.
          ...(mix ? {} : { kind }),
          ...(playlist ? { crossfadeSec: crossfade } : { playlists: held }),
          items: items.map((item) => {
            const min = clampPause(item.intervalMinSec);
            return {
              ...item,
              intervalMinSec: min,
              intervalMaxSec: Math.max(min, clampPause(item.intervalMaxSec)),
            };
          }),
          sceneIds,
          ...tags.body,
          ...(illustrationInput ? { illustration: illustrationInput } : {}),
        },
        image,
      },
      { onSuccess: onClose },
    );
  };

  /**
   * Makes every private sound public, then every private playlist the mix holds (its sounds
   * are public by then), then saves the mix as public.
   */
  const publishAll = async () => {
    for (const sound of privateMembers) {
      await publish.mutateAsync({
        id: sound.id,
        body: { isPublic: true } satisfies UpdateSoundRequest,
      });
    }
    for (const list of privatePlaylists) {
      await publishPlaylist.mutateAsync({
        id: list.id,
        body: { isPublic: true } satisfies UpdateMixRequest,
      });
    }
    setPublishing(false);
    saveMix();
  };


  return (
    <>
      <Dialog
        title={t(
          playlist
            ? mix
              ? 'mixes.editPlaylist'
              : 'mixes.newPlaylist'
            : mix
              ? 'mixes.edit'
              : 'mixes.new',
        )}
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

        {!mix && <p className="text-[13px] leading-5 text-ink-3">{t('mixes.libraryHint')}</p>}

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
            fallback={playlist ? FALLBACK_ICONS.playlist : FALLBACK_ICONS.mix}
            maxImageBytes={me.limits.imageFileBytes}
          />

          <div className="flex flex-col gap-2">
            <PickField
              label={t('mixes.sounds')}
              items={sounds}
              selected={items.map((i) => i.soundId)}
              onChange={setMembers}
              fallback={FALLBACK_ICONS.sound}
              emptyText={t('sounds.pickEmpty')}
              max={me.limits.mixItems}
            />
            <p
              className={
                fields?.items
                  ? 'text-[13px] leading-5 text-danger'
                  : 'text-[13px] leading-5 text-ink-3'
              }
            >
              {fields?.items ?? t('mixes.limit', { n: me.limits.mixItems })}
            </p>
          </div>

          {/* A mix can hold playlists, each one more layer of it; a playlist holds none. */}
          {!playlist && (
            <div className="flex flex-col gap-2">
              <PickField
                label={t('mixes.playlists')}
                items={playlists}
                selected={held.map((p) => p.playlistId)}
                onChange={(ids) =>
                  setHeld((current) =>
                    ids.map(
                      (id) =>
                        current.find((p) => p.playlistId === id) ?? {
                          playlistId: id,
                          volume: DEFAULT_VOLUME,
                        },
                    ),
                  )
                }
                fallback={FALLBACK_ICONS.playlist}
                emptyText={t('mixes.noPlaylists')}
              />
              {fields?.playlists && (
                <p className="text-[13px] leading-5 text-danger">{fields.playlists}</p>
              )}
              {held.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {held.map((entry) => {
                    const found = playlists.find((p) => p.id === entry.playlistId);
                    const label = found?.name ?? t('kind.playlist');
                    return (
                      <li key={entry.playlistId} className="flex min-h-16 items-center gap-3">
                        <Thumb
                          value={found?.illustration ?? { type: 'none' }}
                          fallback={FALLBACK_ICONS.playlist}
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[14px] leading-5">{label}</span>
                          <div className="flex items-center gap-2">
                            <Fader
                              value={entry.volume}
                              onChange={(volume) =>
                                setHeld((current) =>
                                  current.map((p) =>
                                    p.playlistId === entry.playlistId ? { ...p, volume } : p,
                                  ),
                                )
                              }
                              label={t('player.volumeOf', { name: label })}
                            />
                            <Percent value={entry.volume} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </OwnerOnly>

        <PickField
          label={t('sounds.inScenes')}
          items={scenes}
          selected={sceneIds}
          onChange={setSceneIds}
          fallback={FALLBACK_ICONS.scene}
          emptyText={t('sounds.noScenes')}
        />

        <TagFields draft={tags} ownerName={owned ? undefined : mix?.ownerName} errors={fields} />

        {/* A playlist's one transition: every sound blends into the next, the last into the first. */}
        {playlist && (
          <OwnerOnly locked={!owned}>
            <Field label={t('mixes.playlistCrossfade')} hint={t('mixes.playlistCrossfadeHint')}>
              {(id) => (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <input
                      id={id}
                      type="range"
                      className="fader"
                      min={0}
                      max={MAX_CROSSFADE_SEC}
                      step={0.1}
                      value={crossfade}
                      aria-label={t('mixes.playlistCrossfade')}
                      aria-valuetext={t('loop.seconds', { n: crossfade.toFixed(1) })}
                      onChange={(e) => setCrossfade(Number(e.target.value))}
                      style={{ '--v': crossfade / MAX_CROSSFADE_SEC } as CSSProperties}
                    />
                    <span className="w-14 shrink-0 text-right font-mono text-[12px] leading-4 text-ink-3 tabular-nums">
                      {crossfade.toFixed(1)}
                    </span>
                  </div>
                  <CrossfadePreview crossfadeSec={crossfade} />
                </div>
              )}
            </Field>
          </OwnerOnly>
        )}

        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] leading-5 text-ink-2">{t('mixes.items')}</span>
            {!owned && <p className="text-[13px] leading-5 text-ink-3">{t('share.yourVolume')}</p>}
            {playlist && <p className="text-[13px] leading-5 text-ink-3">{t('mixes.playlistHint')}</p>}
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => {
                const sound = byId.get(item.soundId);
                const label = sound?.name ?? t('player.unknownSound');
                return (
                  <li key={item.soundId} className="flex flex-col gap-2 py-1">
                    <div className="flex min-h-16 items-center gap-3">
                      <Thumb
                        value={sound?.illustration ?? { type: 'none' }}
                        fallback={FALLBACK_ICONS.sound}
                      />
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
                      {playlist ? (
                        // Each sound plays once, in this order: no mode, but a place.
                        owned && (
                          <div className="flex shrink-0">
                            <IconButton
                              icon={ChevronUp}
                              label={t('mixes.moveUp', { name: label })}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                              className="size-10"
                            />
                            <IconButton
                              icon={ChevronDown}
                              label={t('mixes.moveDown', { name: label })}
                              disabled={index === items.length - 1}
                              onClick={() => move(index, 1)}
                              className="size-10"
                            />
                          </div>
                        )
                      ) : (
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
                      )}
                      {owned && (
                        <IconButton
                          icon={AudioWaveform}
                          label={t('loop.editItem', { name: label })}
                          onClick={() => setLoopFor(item.soundId)}
                          className="size-10 shrink-0"
                        />
                      )}
                    </div>
                    {!playlist && item.mode === 'recurring' && (
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

        {publishing && (
          <Dialog
            title={t('mixes.publish.title')}
            onClose={() => setPublishing(false)}
            onSubmit={publishAll}
            footer={
              <>
                <Button variant="ghost" onClick={() => setPublishing(false)} className="ml-auto">
                  {t('common.cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  busy={publish.isPending || publishPlaylist.isPending}
                  disabled={publish.isPending || publishPlaylist.isPending}
                >
                  {t('mixes.publish.confirm')}
                </Button>
              </>
            }
          >
            {(publish.error ?? publishPlaylist.error) && (
              <ErrorNote>{errorText(publish.error ?? publishPlaylist.error)}</ErrorNote>
            )}
            <p className="text-[14px] leading-5 text-ink-2">
              {t('mixes.publish.intro', { n: privateMembers.length + privatePlaylists.length })}
            </p>
            <ul className="flex flex-col gap-1.5">
              {privatePlaylists.map((list) => (
                <li key={list.id} className="flex items-center gap-3">
                  <Thumb value={list.illustration} fallback={FALLBACK_ICONS.playlist} size="size-8" />
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">
                    {list.name}
                  </span>
                  <span className="shrink-0 text-[12px] leading-4 text-ink-3">
                    {t('mixes.publish.becomesPublic.playlist')}
                  </span>
                </li>
              ))}
              {privateMembers.map((sound) => (
                <li key={sound.id} className="flex items-center gap-3">
                  <Thumb value={sound.illustration} fallback={FALLBACK_ICONS.sound} size="size-8" />
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-ink">
                    {sound.name}
                  </span>
                  <span className="shrink-0 text-[12px] leading-4 text-ink-3">
                    {t('mixes.publish.becomesPublic')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] leading-5 text-ink-3">{t('mixes.publish.note')}</p>
          </Dialog>
        )}

        {unpublishing && (
          <UnpublishDialog
            holders={holdingMixes}
            addedCount={mix?.addedCount ?? 0}
            busy={save.isPending}
            onConfirm={() => {
              setUnpublishing(false);
              saveMix();
            }}
            onClose={() => setUnpublishing(false)}
          />
        )}
      </Dialog>

      {loopFor && byId.get(loopFor) && (
        <LoopEditorDialog
          sound={byId.get(loopFor)!}
          // A playlist plays each sound once, track start to track end: its range only.
          mode={playlist ? 'oneshot' : items.find((i) => i.soundId === loopFor)!.mode}
          trackOnly={playlist}
          initial={itemLoop(
            byId.get(loopFor)!,
            items.find((i) => i.soundId === loopFor)!,
          )}
          onSave={(loop) => saveItemLoop(loopFor, loop)}
          onClose={() => setLoopFor(null)}
        />
      )}
    </>
  );
}

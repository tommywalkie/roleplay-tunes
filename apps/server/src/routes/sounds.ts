import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parseFile } from 'music-metadata';
import {
  DEFAULT_INTERVAL_MAX_SEC,
  DEFAULT_INTERVAL_MIN_SEC,
  DEFAULT_VOLUME,
  nameSchema,
  updateSoundSchema,
  uploadSoundFieldsSchema,
  type Access,
  type ItemSynonym,
  type PlayMode,
  type Sound,
} from '@dnd/shared';
import { assertOwnCategories, setTags, tagsOf, tagsOfMany } from '../tags.js';
import { taggedBody, taggedResponse } from './tags.js';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { scenes, soundVolumes, sounds } from '../db/schema.js';
import { AppError, conflict, forbidden, invalid, notFound, parse } from '../errors.js';
import { illustrationValues, toIllustration } from '../illustrations.js';
import { effectiveLimits, storageUsed } from '../settings.js';
import {
  addedSoundIds,
  ownerNames,
  prune,
  publicMixesHolding,
  releaseImages,
  soundVolumesOf,
  usableSound,
} from '../sharing.js';
import { audioPath, detectAudioType, receiveUpload, removeFile, storeAudio } from '../storage.js';
import { assertOwned, sceneIdsBySound, setSoundScenes } from './common.js';

type SoundRow = typeof sounds.$inferSelect;

/** Files this short default to One-shot at upload, longer ones to Loop. */
const ONESHOT_MAX_SEC = 10;
/** Tolerance when comparing loop points to the measured duration. */
const DURATION_EPSILON_SEC = 0.05;

/** Response shape of one sound, for the API documentation and the serializer. */
export const soundResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    license: { type: 'string', nullable: true },
    isPublic: { type: 'boolean' },
    access: { type: 'string', enum: ['owner', 'added', 'available'] },
    ownerName: { type: 'string' },
    audioUrl: { type: 'string' },
    mimeType: { type: 'string' },
    sizeBytes: { type: 'integer' },
    durationSec: { type: 'number' },
    defaultMode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
    defaultVolume: { type: 'number' },
    loopStartSec: { type: 'number', nullable: true },
    loopEndSec: { type: 'number', nullable: true },
    intervalMinSec: { type: 'number' },
    intervalMaxSec: { type: 'number' },
    volumeVariation: { type: 'number' },
    illustration: { type: 'object', additionalProperties: true },
    sceneIds: { type: 'array', items: { type: 'string' } },
    ...taggedResponse,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Sound ID' },
  },
} as const;

export interface SoundView {
  access: Access;
  ownerName: string;
  sceneIds: string[];
  /** The viewer's own volume, for a sound they did not upload. */
  volume?: number;
  synonyms: ItemSynonym[];
  categoryIds: string[];
}

export function toSound(row: SoundRow, view: SoundView): Sound {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    license: row.license,
    isPublic: row.isPublic,
    access: view.access,
    ownerName: view.ownerName,
    audioUrl: `/api/sounds/${row.id}/audio`,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSec: row.durationSec,
    defaultMode: row.defaultMode,
    defaultVolume: view.volume ?? row.defaultVolume,
    loopStartSec: row.loopStartSec,
    loopEndSec: row.loopEndSec,
    intervalMinSec: row.intervalMinSec,
    intervalMaxSec: row.intervalMaxSec,
    volumeVariation: row.volumeVariation,
    illustration: toIllustration(row),
    sceneIds: view.sceneIds,
    synonyms: view.synonyms,
    categoryIds: view.categoryIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** One sound as the user sees it. */
function soundFor(userId: string, row: SoundRow, access: Access): Sound {
  return toSound(row, {
    access,
    ownerName: ownerNames([row.ownerId]).get(row.ownerId) ?? '',
    sceneIds: sceneIdsBySound(userId).get(row.id) ?? [],
    volume: access === 'owner' ? undefined : soundVolumesOf(userId).get(row.id),
    ...tagsOf('sound', userId, row.id, row.ownerId),
  });
}

/** Text of a multipart field (undefined for file parts and repeated fields). */
function fieldText(field: unknown): string | undefined {
  if (field && typeof field === 'object' && 'value' in field && typeof field.value === 'string') {
    return field.value;
  }
  return undefined;
}

/** A sound name derived from the uploaded file's name. */
function nameFromFilename(filename: string): string {
  const base = basename(filename, extname(filename))
    .replace(/[_]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100);
  return nameSchema.safeParse(base).success ? base : 'Sound';
}

/** Duration in seconds measured from the file itself, or null if it is not readable audio. */
async function measureDuration(path: string): Promise<number | null> {
  try {
    const { format } = await parseFile(path, { duration: true, skipCovers: true });
    const duration = format.duration;
    return typeof duration === 'number' && Number.isFinite(duration) && duration > 0
      ? duration
      : null;
  } catch {
    return null;
  }
}

/** Fields a user who added the sound from the library may change. */
const ADDED_FIELDS = new Set(['defaultVolume', 'sceneIds', 'synonyms', 'categoryIds']);

export function soundsRoutes(app: FastifyInstance) {
  app.get('/api/sounds', {
    schema: {
      tags: ['sounds'],
      summary: 'List sounds',
      description:
        'Returns the sounds the user owns and the public sounds they added from the library, directly or through a mix.',
      response: {
        200: { type: 'array', items: soundResponse },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const added = addedSoundIds(user.id);
    const rows = db
      .select()
      .from(sounds)
      .where(or(eq(sounds.ownerId, user.id), inArray(sounds.id, [...added])))
      .orderBy(sounds.name)
      .all();
    const sceneIds = sceneIdsBySound(user.id);
    const names = ownerNames(rows.map((r) => r.ownerId));
    const volumes = soundVolumesOf(user.id);
    const tags = tagsOfMany('sound', user.id, new Map(rows.map((r) => [r.id, r.ownerId])));
    return rows.map((row) => {
      const access: Access = row.ownerId === user.id ? 'owner' : 'added';
      return toSound(row, {
        access,
        ownerName: names.get(row.ownerId) ?? '',
        sceneIds: sceneIds.get(row.id) ?? [],
        volume: access === 'owner' ? undefined : volumes.get(row.id),
        ...tags(row.id),
      });
    });
  });

  app.get('/api/sounds/:id', {
    schema: {
      tags: ['sounds'],
      summary: 'Get sound',
      description: 'Returns a single sound the user owns or added.',
      params: idParams,
      response: { 200: soundResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row, access } = usableSound(user.id, id);
    return soundFor(user.id, row, access);
  });

  /**
   * Upload one audio file: multipart with optional text fields `name`, `defaultMode` and
   * `sceneIds` (JSON array) placed before the `file` part.
   */
  app.post(
    '/api/sounds',
    {
      schema: {
        tags: ['sounds'],
        summary: 'Upload sound',
        description: 'Uploads an audio file as a new sound. Multipart form with the audio in the "file" field.',
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary', description: 'Audio file (MP3, M4A, AAC, OGG, WAV, FLAC, WebM)' },
            name: { type: 'string', description: 'Optional display name (defaults to filename)' },
            defaultMode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'], description: 'Optional play mode override' },
            sceneIds: { type: 'string', description: 'Optional JSON array of scene IDs, e.g. ["id1","id2"]' },
          },
        },
        response: {
          201: soundResponse,
          415: { description: 'Unsupported audio type' },
        },
      },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const user = await requireUser(request);
      const limits = effectiveLimits(user);

      if (!request.isMultipart()) throw invalid('Expected multipart/form-data with a "file" part');
      const part = await request.file({ limits: { fileSize: limits.audioFileBytes, files: 1 } });
      if (!part) throw invalid('Expected multipart/form-data with a "file" part');

      const temp = await receiveUpload(part.file, limits.audioFileBytes);
      try {
        const rawSceneIds = fieldText(part.fields.sceneIds);
        let sceneIdsInput: unknown;
        try {
          sceneIdsInput = rawSceneIds === undefined ? undefined : JSON.parse(rawSceneIds);
        } catch {
          throw invalid('Invalid request', { sceneIds: 'Expected a JSON array' });
        }
        const fields = parse(uploadSoundFieldsSchema, {
          name: fieldText(part.fields.name),
          defaultMode: fieldText(part.fields.defaultMode),
          sceneIds: sceneIdsInput,
        });
        if (fields.sceneIds) assertOwned(scenes, user.id, fields.sceneIds, 'sceneIds');

        const type = detectAudioType(temp.head);
        const durationSec = type ? await measureDuration(temp.path) : null;
        if (!type || durationSec === null) {
          throw new AppError(
            415,
            'unsupported_type',
            'Not a readable audio file. Accepted: MP3, M4A, AAC, OGG, WAV, FLAC, WebM',
          );
        }
        if (durationSec > limits.audioDurationSec) {
          throw new AppError(
            400,
            'duration_too_long',
            `Audio is longer than ${limits.audioDurationSec} seconds`,
          );
        }
        if (storageUsed(user.id) + temp.sizeBytes > limits.storageBytes) {
          throw new AppError(400, 'quota_exceeded', 'Storage limit reached');
        }

        const fileKey = await storeAudio(temp, user.id, type.ext);
        const defaultMode: PlayMode =
          fields.defaultMode ?? (durationSec <= ONESHOT_MAX_SEC ? 'oneshot' : 'loop');
        const now = new Date();
        let row: SoundRow;
        try {
          row = db.transaction(() => {
            const inserted = db
              .insert(sounds)
              .values({
                id: randomUUID(),
                ownerId: user.id,
                name: fields.name ?? nameFromFilename(part.filename),
                fileKey,
                mimeType: type.mime,
                sizeBytes: temp.sizeBytes,
                durationSec,
                defaultMode,
                defaultVolume: DEFAULT_VOLUME,
                intervalMinSec: DEFAULT_INTERVAL_MIN_SEC,
                intervalMaxSec: DEFAULT_INTERVAL_MAX_SEC,
                createdAt: now,
                updatedAt: now,
              })
              .returning()
              .get();
            if (fields.sceneIds) setSoundScenes(inserted.id, fields.sceneIds);
            return inserted;
          });
        } catch (error) {
          await removeFile(audioPath(fileKey));
          throw error;
        }
        return reply.code(201).send(soundFor(user.id, row, 'owner'));
      } finally {
        // Already moved on success; this only cleans up after a rejection.
        await removeFile(temp.path);
      }
    },
  );

  app.patch('/api/sounds/:id', {
    schema: {
      tags: ['sounds'],
      summary: 'Update sound',
      description:
        "Updates a sound. The owner may change every field. A user who added the sound from the library may change only `defaultVolume` (their own volume, the owner's is kept) and `sceneIds` (their own scenes).",
      params: idParams,
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string', nullable: true, maxLength: 500 },
          license: { type: 'string', nullable: true, maxLength: 200 },
          isPublic: { type: 'boolean' },
          defaultMode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
          defaultVolume: { type: 'number', minimum: 0, maximum: 1 },
          loopStartSec: { type: 'number', minimum: 0, nullable: true },
          loopEndSec: { type: 'number', minimum: 0, nullable: true },
          intervalMinSec: { type: 'number', minimum: 1, maximum: 3600 },
          intervalMaxSec: { type: 'number', minimum: 1, maximum: 3600 },
          volumeVariation: { type: 'number', minimum: 0, maximum: 1 },
          illustration: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['none', 'icon', 'image'] },
              iconId: { type: 'string' },
              imageKey: { type: 'string' },
            },
          },
          sceneIds: { type: 'array', items: { type: 'string' } },
          ...taggedBody,
        },
      },
      response: { 200: soundResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row: current, access } = usableSound(user.id, id);
    const {
      sceneIds,
      illustration,
      synonyms: synonymList,
      categoryIds,
      ...changes
    } = parse(updateSoundSchema, request.body);
    if (categoryIds) assertOwnCategories(user.id, categoryIds);
    const tags = { synonyms: synonymList, categoryIds };

    if (access !== 'owner') {
      const sent = Object.keys(request.body as object);
      if (sent.some((key) => !ADDED_FIELDS.has(key))) {
        throw forbidden('Only the owner of this sound can change it');
      }
      if (sceneIds) assertOwned(scenes, user.id, sceneIds, 'sceneIds');
      db.transaction(() => {
        setTags('sound', user.id, current.id, tags);
        if (sceneIds) setSoundScenes(current.id, sceneIds);
        if (changes.defaultVolume !== undefined) {
          db.insert(soundVolumes)
            .values({ userId: user.id, soundId: current.id, volume: changes.defaultVolume })
            .onConflictDoUpdate({
              target: [soundVolumes.userId, soundVolumes.soundId],
              set: { volume: changes.defaultVolume },
            })
            .run();
        }
      });
      return soundFor(user.id, current, access);
    }

    const loopStart = changes.loopStartSec !== undefined ? changes.loopStartSec : current.loopStartSec;
    const loopEnd = changes.loopEndSec !== undefined ? changes.loopEndSec : current.loopEndSec;
    if ((loopStart === null) !== (loopEnd === null)) {
      throw invalid('Invalid request', { loopEndSec: 'Set both loop points or neither' });
    }
    if (loopStart !== null && loopEnd !== null) {
      if (loopStart >= loopEnd) {
        throw invalid('Invalid request', { loopEndSec: 'Must be after the loop start' });
      }
      if (loopEnd > current.durationSec + DURATION_EPSILON_SEC) {
        throw invalid('Invalid request', { loopEndSec: 'Is past the end of the sound' });
      }
    }
    const intervalMin = changes.intervalMinSec ?? current.intervalMinSec;
    const intervalMax = changes.intervalMaxSec ?? current.intervalMaxSec;
    if (intervalMin > intervalMax) {
      throw invalid('Invalid request', { intervalMaxSec: 'Must not be below the minimum' });
    }
    const unpublishing = changes.isPublic === false && current.isPublic;
    if (unpublishing) {
      const holding = publicMixesHolding(user.id, current.id);
      if (holding.length > 0) {
        throw conflict('This sound is in a public mix', {
          isPublic: `Make these mixes private first: ${holding.join(', ')}`,
        });
      }
    }
    if (sceneIds) assertOwned(scenes, user.id, sceneIds, 'sceneIds');
    const illustrationChange = illustration ? illustrationValues(illustration, user.id) : undefined;

    const row = db.transaction(() => {
      setTags('sound', user.id, current.id, tags);
      if (sceneIds) setSoundScenes(current.id, sceneIds);
      return db
        .update(sounds)
        .set({ ...changes, ...illustrationChange, updatedAt: new Date() })
        .where(eq(sounds.id, current.id))
        .returning()
        .get();
    });
    if (unpublishing) prune();
    if (illustrationChange && current.imageKey !== row.imageKey) {
      await releaseImages([current.imageKey]);
    }
    return soundFor(user.id, row, 'owner');
  });

  /**
   * Deletes the sound, its files, and its items in mixes. A public sound is also taken
   * out of the libraries, mixes and scenes of everyone who added it.
   */
  app.delete('/api/sounds/:id', {
    schema: {
      tags: ['sounds'],
      summary: 'Delete sound',
      description: 'Permanently deletes a sound and its audio file. Only its owner can.',
      params: idParams,
      response: {
        204: { type: 'null', description: 'Sound deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row, access } = usableSound(user.id, id);
    if (access !== 'owner') throw forbidden('Only the owner of this sound can delete it');
    db.delete(sounds).where(eq(sounds.id, row.id)).run();
    prune();
    await removeFile(audioPath(row.fileKey));
    await releaseImages([row.imageKey]);
    return reply.code(204).send();
  });

  /** The audio file, to its owner and, for a public sound, to everyone, with Range support. */
  app.get('/api/sounds/:id/audio', {
    schema: {
      tags: ['sounds'],
      summary: 'Get audio file',
      description:
        'Streams the audio file of a sound the user owns, or of any public sound. Supports Range requests for seeking.',
      params: idParams,
      response: {
        200: {
          description: 'Audio file stream',
        },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = db.select().from(sounds).where(eq(sounds.id, id)).get();
    if (!row || (row.ownerId !== user.id && !row.isPublic)) throw notFound('Sound');
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.type(row.mimeType);
    return reply.sendFile(row.fileKey, { cacheControl: false });
  });
}

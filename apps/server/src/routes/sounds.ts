import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parseFile } from 'music-metadata';
import {
  DEFAULT_INTERVAL_MAX_SEC,
  DEFAULT_INTERVAL_MIN_SEC,
  DEFAULT_VOLUME,
  nameSchema,
  updateSoundSchema,
  uploadSoundFieldsSchema,
  type PlayMode,
  type Sound,
} from '@dnd/shared';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { scenes, sounds } from '../db/schema.js';
import { AppError, invalid, notFound, parse } from '../errors.js';
import { illustrationValues, toIllustration } from '../illustrations.js';
import { effectiveLimits, storageUsed } from '../settings.js';
import {
  audioPath,
  detectAudioType,
  imagePath,
  receiveUpload,
  removeFile,
  storeAudio,
} from '../storage.js';
import { assertOwned, sceneIdsBySound, setSoundScenes } from './common.js';

type SoundRow = typeof sounds.$inferSelect;

/** Files this short default to One-shot at upload, longer ones to Loop. */
const ONESHOT_MAX_SEC = 10;
/** Tolerance when comparing loop points to the measured duration. */
const DURATION_EPSILON_SEC = 0.05;

function toSound(row: SoundRow, sceneIds: string[]): Sound {
  return {
    id: row.id,
    name: row.name,
    audioUrl: `/api/sounds/${row.id}/audio`,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    durationSec: row.durationSec,
    defaultMode: row.defaultMode,
    defaultVolume: row.defaultVolume,
    loopStartSec: row.loopStartSec,
    loopEndSec: row.loopEndSec,
    intervalMinSec: row.intervalMinSec,
    intervalMaxSec: row.intervalMaxSec,
    volumeVariation: row.volumeVariation,
    illustration: toIllustration(row),
    sceneIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ownSound(userId: string, id: string): SoundRow {
  const row = db
    .select()
    .from(sounds)
    .where(and(eq(sounds.id, id), eq(sounds.ownerId, userId)))
    .get();
  if (!row) throw notFound('Sound');
  return row;
}

function sceneIdsOf(userId: string, soundId: string): string[] {
  return sceneIdsBySound(userId).get(soundId) ?? [];
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

export function soundsRoutes(app: FastifyInstance) {
  app.get('/api/sounds', {
    schema: {
      tags: ['sounds'],
      summary: 'List sounds',
      description: 'Returns all sounds owned by the authenticated user.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
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
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const sceneIds = sceneIdsBySound(user.id);
    return db
      .select()
      .from(sounds)
      .where(eq(sounds.ownerId, user.id))
      .orderBy(sounds.name)
      .all()
      .map((row) => toSound(row, sceneIds.get(row.id) ?? []));
  });

  app.get('/api/sounds/:id', {
    schema: {
      tags: ['sounds'],
      summary: 'Get sound',
      description: 'Returns a single sound by ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
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
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = ownSound(user.id, id);
    return toSound(row, sceneIdsOf(user.id, row.id));
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
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
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
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
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
        return reply.code(201).send(toSound(row, sceneIdsOf(user.id, row.id)));
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
      description: 'Updates a sound\'s metadata (name, play mode, loop points, volume, intervals, illustration, scene membership).',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
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
              type: { type: 'string', enum: ['none', 'icon'] },
              iconId: { type: 'string' },
            },
          },
          sceneIds: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
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
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const current = ownSound(user.id, id);
    const { sceneIds, illustration, ...changes } = parse(updateSoundSchema, request.body);

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
    if (sceneIds) assertOwned(scenes, user.id, sceneIds, 'sceneIds');
    const illustrationChange = illustration ? illustrationValues(illustration) : undefined;

    const row = db.transaction(() => {
      if (sceneIds) setSoundScenes(current.id, sceneIds);
      return db
        .update(sounds)
        .set({ ...changes, ...illustrationChange, updatedAt: new Date() })
        .where(eq(sounds.id, current.id))
        .returning()
        .get();
    });
    if (illustrationChange && current.imageKey) {
      await removeFile(imagePath(user.id, current.imageKey));
    }
    return toSound(row, sceneIdsOf(user.id, row.id));
  });

  /** Deletes the sound, its files, and its items in mixes. */
  app.delete('/api/sounds/:id', {
    schema: {
      tags: ['sounds'],
      summary: 'Delete sound',
      description: 'Permanently deletes a sound and its audio file.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Sound deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = ownSound(user.id, id);
    db.delete(sounds).where(eq(sounds.id, row.id)).run();
    await removeFile(audioPath(row.fileKey));
    if (row.imageKey) await removeFile(imagePath(user.id, row.imageKey));
    return reply.code(204).send();
  });

  /** The audio file, to its owner only, with Range support. */
  app.get('/api/sounds/:id/audio', {
    schema: {
      tags: ['sounds'],
      summary: 'Get audio file',
      description: 'Streams the audio file for a sound. Supports Range requests for seeking.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      response: {
        200: {
          description: 'Audio file stream',
        },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = ownSound(user.id, id);
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    reply.type(row.mimeType);
    return reply.sendFile(row.fileKey, { cacheControl: false });
  });
}

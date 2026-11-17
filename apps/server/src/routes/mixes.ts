import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createMixSchema,
  updateMixSchema,
  type Mix,
  type MixItem,
  type MixItemInput,
} from '@dnd/shared';
import { requireUser, type UserRow } from '../auth.js';
import { db } from '../db/index.js';
import { mixItems, mixes, scenes, sounds } from '../db/schema.js';
import { AppError, invalid, notFound, parse } from '../errors.js';
import { illustrationValues, toIllustration } from '../illustrations.js';
import { effectiveLimits } from '../settings.js';
import { imagePath, removeFile } from '../storage.js';
import { assertOwned, sceneIdsByMix, setMixScenes } from './common.js';

type MixRow = typeof mixes.$inferSelect;
type ItemRow = typeof mixItems.$inferSelect;

function toItem(row: ItemRow): MixItem {
  return {
    id: row.id,
    soundId: row.soundId,
    mode: row.mode,
    volume: row.volume,
    intervalMinSec: row.intervalMinSec,
    intervalMaxSec: row.intervalMaxSec,
    volumeVariation: row.volumeVariation,
  };
}

function toMix(row: MixRow, items: ItemRow[], sceneIds: string[]): Mix {
  return {
    id: row.id,
    name: row.name,
    illustration: toIllustration(row),
    items: items.map(toItem),
    sceneIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ownMix(userId: string, id: string): MixRow {
  const row = db
    .select()
    .from(mixes)
    .where(and(eq(mixes.id, id), eq(mixes.ownerId, userId)))
    .get();
  if (!row) throw notFound('Mix');
  return row;
}

function itemsOf(mixId: string): ItemRow[] {
  return db.select().from(mixItems).where(eq(mixItems.mixId, mixId)).orderBy(mixItems.position).all();
}

function oneMix(userId: string, row: MixRow): Mix {
  return toMix(row, itemsOf(row.id), sceneIdsByMix(userId).get(row.id) ?? []);
}

/**
 * Turns the items of a request into rows: checks the limit, that each sound is the
 * user's and appears once, and fills missing settings from the sound's defaults.
 */
function buildItems(user: UserRow, mixId: string, inputs: MixItemInput[]): ItemRow[] {
  const limit = effectiveLimits(user).mixItems;
  if (inputs.length > limit) {
    throw new AppError(400, 'mix_items_limit', `A mix can hold at most ${limit} sounds`);
  }
  const soundIds = inputs.map((item) => item.soundId);
  if (new Set(soundIds).size !== soundIds.length) {
    throw invalid('Invalid request', { items: 'A sound can appear only once in a mix' });
  }
  assertOwned(sounds, user.id, soundIds, 'items');
  const bySoundId = new Map(
    soundIds.length === 0
      ? []
      : db
          .select()
          .from(sounds)
          .where(inArray(sounds.id, soundIds))
          .all()
          .map((sound) => [sound.id, sound]),
  );

  return inputs.map((input, position) => {
    const sound = bySoundId.get(input.soundId)!;
    const intervalMinSec = input.intervalMinSec ?? sound.intervalMinSec;
    const intervalMaxSec = input.intervalMaxSec ?? sound.intervalMaxSec;
    if (intervalMinSec > intervalMaxSec) {
      throw invalid('Invalid request', {
        [`items.${position}.intervalMaxSec`]: 'Must not be below the minimum',
      });
    }
    return {
      id: randomUUID(),
      mixId,
      soundId: sound.id,
      position,
      mode: input.mode ?? sound.defaultMode,
      volume: input.volume ?? sound.defaultVolume,
      intervalMinSec,
      intervalMaxSec,
      volumeVariation: input.volumeVariation ?? sound.volumeVariation,
    };
  });
}

function replaceItems(mixId: string, rows: ItemRow[]) {
  db.delete(mixItems).where(eq(mixItems.mixId, mixId)).run();
  if (rows.length > 0) db.insert(mixItems).values(rows).run();
}

export function mixesRoutes(app: FastifyInstance) {
  app.get('/api/mixes', {
    schema: {
      tags: ['mixes'],
      summary: 'List mixes',
      description: 'Returns all mixes owned by the authenticated user.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              illustration: { type: 'object', additionalProperties: true },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    soundId: { type: 'string' },
                    mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                    volume: { type: 'number' },
                    intervalMinSec: { type: 'number' },
                    intervalMaxSec: { type: 'number' },
                    volumeVariation: { type: 'number' },
                  },
                },
              },
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
    const rows = db.select().from(mixes).where(eq(mixes.ownerId, user.id)).orderBy(mixes.name).all();
    const items = db
      .select({ item: mixItems })
      .from(mixItems)
      .innerJoin(mixes, eq(mixes.id, mixItems.mixId))
      .where(eq(mixes.ownerId, user.id))
      .orderBy(mixItems.position)
      .all();
    const itemsByMix = new Map<string, ItemRow[]>();
    for (const { item } of items) {
      const list = itemsByMix.get(item.mixId);
      if (list) list.push(item);
      else itemsByMix.set(item.mixId, [item]);
    }
    const sceneIds = sceneIdsByMix(user.id);
    return rows.map((row) => toMix(row, itemsByMix.get(row.id) ?? [], sceneIds.get(row.id) ?? []));
  });

  app.get('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Get mix',
      description: 'Returns a single mix by ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Mix ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            illustration: { type: 'object', additionalProperties: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  soundId: { type: 'string' },
                  mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                  volume: { type: 'number' },
                  intervalMinSec: { type: 'number' },
                  intervalMaxSec: { type: 'number' },
                  volumeVariation: { type: 'number' },
                },
              },
            },
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
    return oneMix(user.id, ownMix(user.id, id));
  });

  app.post('/api/mixes', {
    schema: {
      tags: ['mixes'],
      summary: 'Create mix',
      description: 'Creates a new mix with an ordered list of sound items.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          illustration: { type: 'object', properties: { type: { type: 'string', enum: ['none', 'icon'] }, iconId: { type: 'string' } } },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                soundId: { type: 'string' },
                mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                volume: { type: 'number' },
                intervalMinSec: { type: 'number' },
                intervalMaxSec: { type: 'number' },
                volumeVariation: { type: 'number' },
              },
            },
          },
          sceneIds: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            illustration: { type: 'object', additionalProperties: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  soundId: { type: 'string' },
                  mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                  volume: { type: 'number' },
                  intervalMinSec: { type: 'number' },
                  intervalMaxSec: { type: 'number' },
                  volumeVariation: { type: 'number' },
                },
              },
            },
            sceneIds: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const body = parse(createMixSchema, request.body);
    const id = randomUUID();
    const items = buildItems(user, id, body.items ?? []);
    if (body.sceneIds) assertOwned(scenes, user.id, body.sceneIds, 'sceneIds');
    const illustration = body.illustration ? illustrationValues(body.illustration) : undefined;

    const now = new Date();
    const row = db.transaction(() => {
      const inserted = db
        .insert(mixes)
        .values({ id, ownerId: user.id, name: body.name, ...illustration, createdAt: now, updatedAt: now })
        .returning()
        .get();
      replaceItems(id, items);
      if (body.sceneIds) setMixScenes(id, body.sceneIds);
      return inserted;
    });
    return reply.code(201).send(oneMix(user.id, row));
  });

  /** `items`, when present, replaces the whole list. */
  app.patch('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Update mix',
      description: 'Updates a mix. When `items` is present, replaces the entire item list.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Mix ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          illustration: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['none', 'icon'] },
              iconId: { type: 'string' },
            },
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                soundId: { type: 'string' },
                mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                volume: { type: 'number', minimum: 0, maximum: 1 },
                intervalMinSec: { type: 'number', minimum: 1, maximum: 3600 },
                intervalMaxSec: { type: 'number', minimum: 1, maximum: 3600 },
                volumeVariation: { type: 'number', minimum: 0, maximum: 1 },
              },
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
            illustration: { type: 'object', additionalProperties: true },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  soundId: { type: 'string' },
                  mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
                  volume: { type: 'number' },
                  intervalMinSec: { type: 'number' },
                  intervalMaxSec: { type: 'number' },
                  volumeVariation: { type: 'number' },
                },
              },
            },
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
    const current = ownMix(user.id, id);
    const body = parse(updateMixSchema, request.body);
    const items = body.items ? buildItems(user, current.id, body.items) : undefined;
    if (body.sceneIds) assertOwned(scenes, user.id, body.sceneIds, 'sceneIds');
    const illustration = body.illustration ? illustrationValues(body.illustration) : undefined;

    const row = db.transaction(() => {
      if (items) replaceItems(current.id, items);
      if (body.sceneIds) setMixScenes(current.id, body.sceneIds);
      return db
        .update(mixes)
        .set({ ...(body.name ? { name: body.name } : {}), ...illustration, updatedAt: new Date() })
        .where(eq(mixes.id, current.id))
        .returning()
        .get();
    });
    if (illustration && current.imageKey) await removeFile(imagePath(user.id, current.imageKey));
    return oneMix(user.id, row);
  });

  app.delete('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Delete mix',
      description: 'Permanently deletes a mix.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Mix ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Mix deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = ownMix(user.id, id);
    db.delete(mixes).where(eq(mixes.id, row.id)).run();
    if (row.imageKey) await removeFile(imagePath(user.id, row.imageKey));
    return reply.code(204).send();
  });
}

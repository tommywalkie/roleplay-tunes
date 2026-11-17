import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createSceneSchema, orderScenesSchema, updateSceneSchema, type Scene } from '@dnd/shared';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { mixes, sceneMixes, sceneSounds, scenes, sounds } from '../db/schema.js';
import { invalid, notFound, parse } from '../errors.js';
import { illustrationValues, toIllustration } from '../illustrations.js';
import { imagePath, removeFile } from '../storage.js';
import { assertOwned } from './common.js';

type SceneRow = typeof scenes.$inferSelect;

function ownScene(userId: string, id: string): SceneRow {
  const row = db
    .select()
    .from(scenes)
    .where(and(eq(scenes.id, id), eq(scenes.ownerId, userId)))
    .get();
  if (!row) throw notFound('Scene');
  return row;
}

function toScene(row: SceneRow, soundIds: string[], mixIds: string[]): Scene {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    illustration: toIllustration(row),
    soundIds,
    mixIds,
    createdAt: row.createdAt.toISOString(),
  };
}

function oneScene(row: SceneRow): Scene {
  const soundIds = db
    .select({ id: sceneSounds.soundId })
    .from(sceneSounds)
    .where(eq(sceneSounds.sceneId, row.id))
    .all()
    .map((r) => r.id);
  const mixIds = db
    .select({ id: sceneMixes.mixId })
    .from(sceneMixes)
    .where(eq(sceneMixes.sceneId, row.id))
    .all()
    .map((r) => r.id);
  return toScene(row, soundIds, mixIds);
}

function setMembers(sceneId: string, soundIds?: string[], mixIds?: string[]) {
  if (soundIds) {
    db.delete(sceneSounds).where(eq(sceneSounds.sceneId, sceneId)).run();
    const unique = [...new Set(soundIds)];
    if (unique.length > 0) {
      db.insert(sceneSounds)
        .values(unique.map((soundId) => ({ sceneId, soundId })))
        .run();
    }
  }
  if (mixIds) {
    db.delete(sceneMixes).where(eq(sceneMixes.sceneId, sceneId)).run();
    const unique = [...new Set(mixIds)];
    if (unique.length > 0) {
      db.insert(sceneMixes)
        .values(unique.map((mixId) => ({ sceneId, mixId })))
        .run();
    }
  }
}

export function scenesRoutes(app: FastifyInstance) {
  app.get('/api/scenes', {
    schema: {
      tags: ['scenes'],
      summary: 'List scenes',
      description: 'Returns all scenes owned by the authenticated user, ordered by position.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              position: { type: 'integer' },
              illustration: { type: 'object', additionalProperties: true },
              soundIds: { type: 'array', items: { type: 'string' } },
              mixIds: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const rows = db
      .select()
      .from(scenes)
      .where(eq(scenes.ownerId, user.id))
      .orderBy(scenes.position)
      .all();
    return rows.map(oneScene);
  });

  app.get('/api/scenes/:id', {
    schema: {
      tags: ['scenes'],
      summary: 'Get scene',
      description: 'Returns a single scene by ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Scene ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            position: { type: 'integer' },
            illustration: { type: 'object', additionalProperties: true },
            soundIds: { type: 'array', items: { type: 'string' } },
            mixIds: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    return oneScene(ownScene(user.id, id));
  });

  app.post('/api/scenes', {
    schema: {
      tags: ['scenes'],
      summary: 'Create scene',
      description: 'Creates a new scene, optionally with referenced sound and mix IDs.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          illustration: { type: 'object', properties: { type: { type: 'string', enum: ['none', 'icon'] }, iconId: { type: 'string' } } },
          soundIds: { type: 'array', items: { type: 'string' } },
          mixIds: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            position: { type: 'integer' },
            illustration: { type: 'object', additionalProperties: true },
            soundIds: { type: 'array', items: { type: 'string' } },
            mixIds: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const body = parse(createSceneSchema, request.body);
    if (body.soundIds) assertOwned(sounds, user.id, body.soundIds, 'soundIds');
    if (body.mixIds) assertOwned(mixes, user.id, body.mixIds, 'mixIds');
    const illustration = body.illustration ? illustrationValues(body.illustration) : undefined;

    const row = db.transaction(() => {
      const last = db
        .select({ max: sql<number | null>`max(${scenes.position})` })
        .from(scenes)
        .where(eq(scenes.ownerId, user.id))
        .get();
      const inserted = db
        .insert(scenes)
        .values({
          id: randomUUID(),
          ownerId: user.id,
          name: body.name,
          position: (last?.max ?? -1) + 1,
          ...illustration,
          createdAt: new Date(),
        })
        .returning()
        .get();
      setMembers(inserted.id, body.soundIds, body.mixIds);
      return inserted;
    });
    return reply.code(201).send(oneScene(row));
  });

  /** Sets the order of all the caller's scenes at once. */
  app.put('/api/scenes/order', {
    schema: {
      tags: ['scenes'],
      summary: 'Reorder scenes',
      description: 'Sets the display order of all the caller\'s scenes at once.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Scene IDs in the desired order, each exactly once',
          },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              position: { type: 'integer' },
              illustration: { type: 'object', additionalProperties: true },
              soundIds: { type: 'array', items: { type: 'string' } },
              mixIds: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { ids } = parse(orderScenesSchema, request.body);
    const own = db.select({ id: scenes.id }).from(scenes).where(eq(scenes.ownerId, user.id)).all();
    const ownIds = new Set(own.map((s) => s.id));
    if (new Set(ids).size !== ids.length || ids.length !== ownIds.size || !ids.every((id) => ownIds.has(id))) {
      throw invalid('Invalid request', { ids: 'Must list each of your scenes exactly once' });
    }
    db.transaction(() => {
      ids.forEach((id, position) => {
        db.update(scenes).set({ position }).where(eq(scenes.id, id)).run();
      });
    });
    return db
      .select()
      .from(scenes)
      .where(eq(scenes.ownerId, user.id))
      .orderBy(scenes.position)
      .all()
      .map(oneScene);
  });

  /** `soundIds` and `mixIds`, when present, each replace the whole list. */
  app.patch('/api/scenes/:id', {
    schema: {
      tags: ['scenes'],
      summary: 'Update scene',
      description: 'Updates a scene. When `soundIds` or `mixIds` is present, each replaces the whole list.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Scene ID' },
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
          soundIds: { type: 'array', items: { type: 'string' } },
          mixIds: { type: 'array', items: { type: 'string' } },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            position: { type: 'integer' },
            illustration: { type: 'object', additionalProperties: true },
            soundIds: { type: 'array', items: { type: 'string' } },
            mixIds: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const current = ownScene(user.id, id);
    const body = parse(updateSceneSchema, request.body);
    if (body.soundIds) assertOwned(sounds, user.id, body.soundIds, 'soundIds');
    if (body.mixIds) assertOwned(mixes, user.id, body.mixIds, 'mixIds');
    const illustration = body.illustration ? illustrationValues(body.illustration) : undefined;

    const row = db.transaction(() => {
      setMembers(current.id, body.soundIds, body.mixIds);
      const changes = { ...(body.name ? { name: body.name } : {}), ...illustration };
      if (Object.keys(changes).length === 0) return current;
      return db.update(scenes).set(changes).where(eq(scenes.id, current.id)).returning().get();
    });
    if (illustration && current.imageKey) await removeFile(imagePath(user.id, current.imageKey));
    return oneScene(row);
  });

  /** Deletes the scene only. Its sounds and mixes are kept. */
  app.delete('/api/scenes/:id', {
    schema: {
      tags: ['scenes'],
      summary: 'Delete scene',
      description: 'Deletes a scene. Its sounds and mixes are kept.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Scene ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Scene deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const row = ownScene(user.id, id);
    db.delete(scenes).where(eq(scenes.id, row.id)).run();
    if (row.imageKey) await removeFile(imagePath(user.id, row.imageKey));
    return reply.code(204).send();
  });
}

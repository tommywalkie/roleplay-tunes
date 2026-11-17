/**
 * Image routes for sounds.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { mixes, scenes, sounds } from '../db/schema.js';
import { invalid, notFound, parse } from '../errors.js';
import { config } from '../config.js';
import { imageRelPath, storeImage } from '../storage.js';
import { z } from 'zod';

function getResource(table: typeof sounds | typeof mixes | typeof scenes, id: string) {
  return db.select().from(table).where(eq(table.id, id)).get();
}

async function getImageOwner(key: string): Promise<{ ownerId: string } | null> {
  // Try sounds first
  let row = db.select({ ownerId: sounds.ownerId }).from(sounds).where(eq(sounds.imageKey, key)).get();
  if (row) return row;

  // Try mixes
  row = db.select({ ownerId: mixes.ownerId }).from(mixes).where(eq(mixes.imageKey, key)).get();
  if (row) return row;

  // Try scenes
  row = db.select({ ownerId: scenes.ownerId }).from(scenes).where(eq(scenes.imageKey, key)).get();
  return row ?? null;
}

export async function imagesRoutes(app: FastifyInstance) {
  // PUT /api/sounds/:id/image - Upload image for a sound
  app.put('/api/sounds/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Upload sound image',
      description: 'Uploads an image for a sound. Multipart form with the image in the "file" field.',
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      body: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Image file (JPEG, PNG, WebP)' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image uploaded' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: soundId } = parse(z.object({ id: z.string() }), request.params);

    const sound = getResource(sounds, soundId);
    if (!sound || sound.ownerId !== user.id) {
      throw notFound('Sound');
    }

    const limit = user.limitImageFileBytes ?? 5 * 1024 * 1024;

    if (!request.isMultipart()) {
      throw invalid('Expected multipart/form-data with a "file" part');
    }
    const part = await request.file({ limits: { fileSize: limit, files: 1 } });
    if (!part) throw invalid('Expected multipart/form-data with a "file" part');

    const image = await storeImage(part.file, limit, user.id);

    try {
      await db
        .update(sounds)
        .set({ illustrationType: 'image', imageKey: image.key, imageBytes: image.bytes })
        .where(eq(sounds.id, soundId))
        .run();
      reply.code(204).send();
    } catch (error) {
      await image.cleanup();
      throw error;
    }
  });

  // DELETE /api/sounds/:id/image - Remove image from a sound
  app.delete('/api/sounds/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Delete sound image',
      description: 'Removes the image from a sound.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Sound ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image removed' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: soundId } = parse(z.object({ id: z.string() }), request.params);

    const sound = getResource(sounds, soundId);
    if (!sound || sound.ownerId !== user.id) {
      throw notFound('Sound');
    }

    if (sound.imageKey) {
      await db
        .update(sounds)
        .set({ illustrationType: 'none', imageKey: null, imageBytes: 0 })
        .where(eq(sounds.id, soundId))
        .run();
    }

    reply.code(204).send();
  });

  // PUT /api/mixes/:id/image - Upload image for a mix
  app.put('/api/mixes/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Upload mix image',
      description: 'Uploads an image for a mix. Multipart form with the image in the "file" field.',
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Mix ID' },
        },
      },
      body: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Image file (JPEG, PNG, WebP)' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image uploaded' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: mixId } = parse(z.object({ id: z.string() }), request.params);

    const mix = getResource(mixes, mixId);
    if (!mix || mix.ownerId !== user.id) {
      throw notFound('Mix');
    }

    const limit = user.limitImageFileBytes ?? 5 * 1024 * 1024;

    if (!request.isMultipart()) {
      throw invalid('Expected multipart/form-data with a "file" part');
    }
    const part = await request.file({ limits: { fileSize: limit, files: 1 } });
    if (!part) throw invalid('Expected multipart/form-data with a "file" part');

    const image = await storeImage(part.file, limit, user.id);

    try {
      await db
        .update(mixes)
        .set({ illustrationType: 'image', imageKey: image.key, imageBytes: image.bytes })
        .where(eq(mixes.id, mixId))
        .run();
      reply.code(204).send();
    } catch (error) {
      await image.cleanup();
      throw error;
    }
  });

  // DELETE /api/mixes/:id/image - Remove image from a mix
  app.delete('/api/mixes/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Delete mix image',
      description: 'Removes the image from a mix.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Mix ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image removed' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: mixId } = parse(z.object({ id: z.string() }), request.params);

    const mix = getResource(mixes, mixId);
    if (!mix || mix.ownerId !== user.id) {
      throw notFound('Mix');
    }

    if (mix.imageKey) {
      await db
        .update(mixes)
        .set({ illustrationType: 'none', imageKey: null, imageBytes: 0 })
        .where(eq(mixes.id, mixId))
        .run();
    }

    reply.code(204).send();
  });

  // PUT /api/scenes/:id/image - Upload image for a scene
  app.put('/api/scenes/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Upload scene image',
      description: 'Uploads an image for a scene. Multipart form with the image in the "file" field.',
      consumes: ['multipart/form-data'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Scene ID' },
        },
      },
      body: {
        type: 'object',
        required: ['file'],
        properties: {
          file: { type: 'string', format: 'binary', description: 'Image file (JPEG, PNG, WebP)' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image uploaded' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: sceneId } = parse(z.object({ id: z.string() }), request.params);

    const scene = getResource(scenes, sceneId);
    if (!scene || scene.ownerId !== user.id) {
      throw notFound('Scene');
    }

    const limit = user.limitImageFileBytes ?? 5 * 1024 * 1024;

    if (!request.isMultipart()) {
      throw invalid('Expected multipart/form-data with a "file" part');
    }
    const part = await request.file({ limits: { fileSize: limit, files: 1 } });
    if (!part) throw invalid('Expected multipart/form-data with a "file" part');

    const image = await storeImage(part.file, limit, user.id);

    try {
      await db
        .update(scenes)
        .set({ illustrationType: 'image', imageKey: image.key, imageBytes: image.bytes })
        .where(eq(scenes.id, sceneId))
        .run();
      reply.code(204).send();
    } catch (error) {
      await image.cleanup();
      throw error;
    }
  });

  // DELETE /api/scenes/:id/image - Remove image from a scene
  app.delete('/api/scenes/:id/image', {
    schema: {
      tags: ['images'],
      summary: 'Delete scene image',
      description: 'Removes the image from a scene.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Scene ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'Image removed' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id: sceneId } = parse(z.object({ id: z.string() }), request.params);

    const scene = getResource(scenes, sceneId);
    if (!scene || scene.ownerId !== user.id) {
      throw notFound('Scene');
    }

    if (scene.imageKey) {
      await db
        .update(scenes)
        .set({ illustrationType: 'none', imageKey: null, imageBytes: 0 })
        .where(eq(scenes.id, sceneId))
        .run();
    }

    reply.code(204).send();
  });

  // GET /api/images/:key - Serve image with ownership check. The key is the bare
  // uuid stored in imageKey, so the client-visible URL /api/images/<key> from
  // toIllustration() is a single path segment and matches this route's :key param.
  app.get('/api/images/:key', {
    schema: {
      tags: ['images'],
      summary: 'Get image',
      description: 'Serves an uploaded image file by key, with ownership check.',
      params: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', description: 'Image key (UUID)' },
        },
      },
      response: {
        200: { description: 'Image file' },
        404: { description: 'Image not found' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { key } = parse(z.object({ key: z.string() }), request.params);

    const row = await getImageOwner(key);

    if (!row || row.ownerId !== user.id) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'Image not found' } });
    }

    // Image files live under imageDir, not under the static root reply.sendFile would
    // otherwise resolve against (audioDir), so the root is passed explicitly.
    reply.header('cache-control', 'private, max-age=31536000, immutable');
    return reply.sendFile(imageRelPath(row.ownerId, key), config.imageDir, {
      cacheControl: false,
    });
  });
}

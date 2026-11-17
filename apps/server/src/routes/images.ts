/**
 * Image routes: upload or remove the image of a sound, mix or scene, list the images a
 * user can reuse, and serve an image.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ReusableImage } from '@dnd/shared';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { images, mixes, scenes, sounds } from '../db/schema.js';
import { invalid, notFound, parse } from '../errors.js';
import { config } from '../config.js';
import { canSeeImage, releaseImages, usableImageKeys } from '../sharing.js';
import { imageRelPath, storeImage } from '../storage.js';

const KINDS = [
  { path: 'sounds', table: sounds, label: 'Sound', name: 'sound' },
  { path: 'mixes', table: mixes, label: 'Mix', name: 'mix' },
  { path: 'scenes', table: scenes, label: 'Scene', name: 'scene' },
] as const;

export async function imagesRoutes(app: FastifyInstance) {
  for (const { path, table, label, name } of KINDS) {
    const params = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: `${label} ID` } },
    };

    /** The image of an item can only change from the account that owns it. */
    const ownItem = (userId: string, id: string) => {
      const row = db.select().from(table).where(eq(table.id, id)).get();
      if (!row || row.ownerId !== userId) throw notFound(label);
      return row;
    };

    app.put(`/api/${path}/:id/image`, {
      schema: {
        tags: ['images'],
        summary: `Upload ${name} image`,
        description: `Uploads an image for a ${name}. Multipart form with the image in the "file" field.`,
        consumes: ['multipart/form-data'],
        params,
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
      const { id } = parse(z.object({ id: z.string() }), request.params);
      const item = ownItem(user.id, id);

      const limit = user.limitImageFileBytes ?? 5 * 1024 * 1024;

      if (!request.isMultipart()) {
        throw invalid('Expected multipart/form-data with a "file" part');
      }
      const part = await request.file({ limits: { fileSize: limit, files: 1 } });
      if (!part) throw invalid('Expected multipart/form-data with a "file" part');

      const image = await storeImage(part.file, limit, user.id);

      try {
        db.transaction(() => {
          db.insert(images)
            .values({ key: image.key, ownerId: user.id, bytes: image.bytes, createdAt: new Date() })
            .run();
          db.update(table)
            .set({
              illustrationType: 'image',
              iconId: null,
              iconSvg: null,
              imageKey: image.key,
              imageBytes: image.bytes,
            })
            .where(eq(table.id, id))
            .run();
        });
      } catch (error) {
        await image.cleanup();
        throw error;
      }
      await releaseImages([item.imageKey]);
      return reply.code(204).send();
    });

    app.delete(`/api/${path}/:id/image`, {
      schema: {
        tags: ['images'],
        summary: `Delete ${name} image`,
        description: `Removes the image from a ${name}.`,
        params,
        response: {
          204: { type: 'null', description: 'Image removed' },
        },
      },
    }, async (request, reply) => {
      const user = await requireUser(request);
      const { id } = parse(z.object({ id: z.string() }), request.params);
      const item = ownItem(user.id, id);

      if (item.imageKey) {
        db.update(table)
          .set({ illustrationType: 'none', imageKey: null, imageBytes: 0 })
          .where(eq(table.id, id))
          .run();
        await releaseImages([item.imageKey]);
      }

      return reply.code(204).send();
    });
  }

  app.get('/api/images', {
    schema: {
      tags: ['images'],
      summary: 'List reusable images',
      description:
        'Images the user can put on their own items: the ones they uploaded and the ones shown by items they own or added from the library. Newest first.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request): Promise<ReusableImage[]> => {
    const user = await requireUser(request);
    return usableImageKeys(user.id).map((key) => ({ key, url: `/api/images/${key}` }));
  });

  // The key is the bare uuid stored in imageKey, so the client-visible URL
  // /api/images/<key> from toIllustration() is a single path segment.
  app.get('/api/images/:key', {
    schema: {
      tags: ['images'],
      summary: 'Get image',
      description:
        'Serves an uploaded image file by key, to its uploader, to users whose items show it, and to everyone when a public item shows it.',
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

    const row = db.select({ ownerId: images.ownerId }).from(images).where(eq(images.key, key)).get();
    if (!row || !canSeeImage(user.id, key)) {
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

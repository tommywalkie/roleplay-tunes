/**
 * The public library: every public sound and mix, from any account. Adding one to your
 * own library lets you use it without copying it: it stays its owner's, and does not
 * count against your storage.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Access, Library } from '@dnd/shared';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { libraryMixes, librarySounds, mixItems, mixes, sounds } from '../db/schema.js';
import { conflict, notFound } from '../errors.js';
import {
  addedMixIds,
  addedSoundIds,
  directlyAddedSoundIds,
  mixColumns,
  mixVolumesOf,
  ownerNames,
  prune,
  soundColumns,
  soundLoopsOf,
  soundVolumesOf,
} from '../sharing.js';
import { tagsOfMany } from '../tags.js';
import { sceneIdsByMix, sceneIdsBySound } from './common.js';
import { itemsByMix, mixResponse, playlistsByMix, toMix } from './mixes.js';
import { soundResponse, toSound } from './sounds.js';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

/** A public item that someone else owns, or "not found". */
function othersPublic(table: typeof sounds | typeof mixes, userId: string, id: string, what: string) {
  const row = db
    .select({ id: table.id, ownerId: table.ownerId })
    .from(table)
    .where(and(eq(table.id, id), eq(table.isPublic, true)))
    .get();
  if (!row) throw notFound(what);
  if (row.ownerId === userId) throw conflict(`This ${what.toLowerCase()} is already yours`);
  return row;
}

export function libraryRoutes(app: FastifyInstance) {
  app.get('/api/library', {
    schema: {
      tags: ['library'],
      summary: 'Public library',
      description:
        'Every public sound and mix, with how the user relates to each: owner, added, or available to add.',
      response: {
        200: {
          type: 'object',
          properties: {
            sounds: { type: 'array', items: soundResponse },
            mixes: { type: 'array', items: mixResponse },
          },
        },
      },
    },
  }, async (request): Promise<Library> => {
    const user = await requireUser(request);
    const soundRows = db
      .select(soundColumns)
      .from(sounds)
      .where(eq(sounds.isPublic, true))
      .orderBy(sounds.name)
      .all();
    const mixRows = db
      .select(mixColumns)
      .from(mixes)
      .where(eq(mixes.isPublic, true))
      .orderBy(mixes.name)
      .all();
    const names = ownerNames([...soundRows, ...mixRows].map((r) => r.ownerId));
    const usedSounds = addedSoundIds(user.id);
    const usedMixes = addedMixIds(user.id);
    const soundScenes = sceneIdsBySound(user.id);
    const mixScenes = sceneIdsByMix(user.id);
    const soundVolumes = soundVolumesOf(user.id);
    const soundLoops = soundLoopsOf(user.id);
    const mixVolumes = mixVolumesOf(user.id);
    const items = itemsByMix(mixRows.map((r) => r.id));
    const playlists = playlistsByMix(mixRows.map((r) => r.id));
    const soundTags = tagsOfMany('sound', user.id, new Map(soundRows.map((r) => [r.id, r.ownerId])));
    const mixTags = tagsOfMany('mix', user.id, new Map(mixRows.map((r) => [r.id, r.ownerId])));

    const accessOf = (ownerId: string, added: boolean): Access =>
      ownerId === user.id ? 'owner' : added ? 'added' : 'available';

    return {
      sounds: soundRows.map((row) => {
        const access = accessOf(row.ownerId, usedSounds.has(row.id));
        return toSound(row, {
          access,
          ownerName: names.get(row.ownerId) ?? '',
          sceneIds: soundScenes.get(row.id) ?? [],
          volume: access === 'owner' ? undefined : soundVolumes.get(row.id),
          loop: access === 'owner' ? undefined : soundLoops.get(row.id),
          ...soundTags(row.id),
        });
      }),
      mixes: mixRows.map((row) => {
        const access = accessOf(row.ownerId, usedMixes.has(row.id));
        return toMix(row, items.get(row.id) ?? [], {
          access,
          ownerName: names.get(row.ownerId) ?? '',
          sceneIds: mixScenes.get(row.id) ?? [],
          volumes: access === 'owner' ? undefined : mixVolumes.get(row.id),
          playlists: playlists.get(row.id),
          ...mixTags(row.id),
        });
      }),
    };
  });

  app.put('/api/library/sounds/:id', {
    schema: {
      tags: ['library'],
      summary: 'Add a sound to my library',
      description: 'Adds a public sound of another account to the user\'s library.',
      params: idParams,
      response: { 204: { type: 'null', description: 'Added' } },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    othersPublic(sounds, user.id, id, 'Sound');
    db.insert(librarySounds)
      .values({ userId: user.id, soundId: id, createdAt: new Date() })
      .onConflictDoNothing()
      .run();
    return reply.code(204).send();
  });

  app.delete('/api/library/sounds/:id', {
    schema: {
      tags: ['library'],
      summary: 'Remove a sound from my library',
      description:
        'Removes an added sound from the user\'s library, mixes and scenes. Refused while a mix of the library holds it.',
      params: idParams,
      response: { 204: { type: 'null', description: 'Removed' } },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    if (!directlyAddedSoundIds(user.id).has(id)) throw notFound('Sound');
    // All or nothing: while a mix the user added (or a playlist that came with one) holds the
    // sound, nothing changes. Those mixes are not theirs and need it.
    const added = [...addedMixIds(user.id)];
    const viaMix =
      added.length === 0
        ? undefined
        : db
            .select({ name: mixes.name })
            .from(mixItems)
            .innerJoin(mixes, eq(mixes.id, mixItems.mixId))
            .where(and(inArray(mixItems.mixId, added), eq(mixItems.soundId, id)))
            .get();
    if (viaMix) {
      throw conflict('A mix in your library uses this sound', {
        sound: `Remove "${viaMix.name}" from your library first`,
      });
    }
    db.delete(librarySounds)
      .where(and(eq(librarySounds.userId, user.id), eq(librarySounds.soundId, id)))
      .run();
    prune();
    return reply.code(204).send();
  });

  app.put('/api/library/mixes/:id', {
    schema: {
      tags: ['library'],
      summary: 'Add a mix to my library',
      description:
        'Adds a public mix of another account to the user\'s library. Its sounds come with it.',
      params: idParams,
      response: { 204: { type: 'null', description: 'Added' } },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    othersPublic(mixes, user.id, id, 'Mix');
    db.insert(libraryMixes)
      .values({ userId: user.id, mixId: id, createdAt: new Date() })
      .onConflictDoNothing()
      .run();
    return reply.code(204).send();
  });

  app.delete('/api/library/mixes/:id', {
    schema: {
      tags: ['library'],
      summary: 'Remove a mix from my library',
      description:
        'Removes an added mix from the user\'s library and scenes, with the sounds that came only through it.',
      params: idParams,
      response: { 204: { type: 'null', description: 'Removed' } },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const removed = db
      .delete(libraryMixes)
      .where(and(eq(libraryMixes.userId, user.id), eq(libraryMixes.mixId, id)))
      .run();
    if (removed.changes === 0) throw notFound('Mix');
    prune();
    return reply.code(204).send();
  });
}

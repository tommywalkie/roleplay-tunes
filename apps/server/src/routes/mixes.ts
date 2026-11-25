import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  createMixSchema,
  loopSettingsError,
  mixVolumesSchema,
  updateMixSchema,
  type Access,
  type Mix,
  type MixItem,
  type ItemSynonym,
  type MixItemInput,
} from '@dnd/shared';
import { assertOwnCategories, setTags, tagsOf, tagsOfMany } from '../tags.js';
import { taggedBody, taggedResponse } from './tags.js';
import { requireUser, type UserRow } from '../auth.js';
import { db } from '../db/index.js';
import { mixItems, mixVolumes, mixes, scenes, sounds } from '../db/schema.js';
import { AppError, forbidden, invalid, parse } from '../errors.js';
import { illustrationValues, toIllustration } from '../illustrations.js';
import { effectiveLimits } from '../settings.js';
import {
  addedMixIds,
  assertAllPublic,
  assertUsableSounds,
  mixColumns,
  mixVolumesOf,
  ownerNames,
  prune,
  releaseImages,
  soundVolumesOf,
  usableMix,
  type CountedMix,
} from '../sharing.js';
import { assertOwned, sceneIdsByMix, setMixScenes } from './common.js';

type ItemRow = typeof mixItems.$inferSelect;

const itemResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    soundId: { type: 'string' },
    mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
    volume: { type: 'number' },
    intervalMinSec: { type: 'number' },
    intervalMaxSec: { type: 'number' },
    volumeVariation: { type: 'number' },
    trackStartSec: { type: 'number', nullable: true },
    trackEndSec: { type: 'number', nullable: true },
    loopStartSec: { type: 'number', nullable: true },
    loopEndSec: { type: 'number', nullable: true },
    loopMode: { type: 'string', enum: ['gapless', 'crossfade'], nullable: true },
    crossfadeSec: { type: 'number', nullable: true },
  },
} as const;

/** Response shape of one mix, for the API documentation and the serializer. */
export const mixResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    isPublic: { type: 'boolean' },
    access: { type: 'string', enum: ['owner', 'added', 'available'] },
    addedCount: { type: 'integer', description: 'How many users have it in their library' },
    ownerName: { type: 'string' },
    illustration: { type: 'object', additionalProperties: true },
    items: { type: 'array', items: itemResponse },
    sceneIds: { type: 'array', items: { type: 'string' } },
    ...taggedResponse,
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const itemBody = {
  type: 'object',
  properties: {
    soundId: { type: 'string' },
    mode: { type: 'string', enum: ['loop', 'oneshot', 'recurring'] },
    volume: { type: 'number', minimum: 0, maximum: 1 },
    intervalMinSec: { type: 'number', minimum: 1, maximum: 3600 },
    intervalMaxSec: { type: 'number', minimum: 1, maximum: 3600 },
    volumeVariation: { type: 'number', minimum: 0, maximum: 1 },
    trackStartSec: { type: 'number', minimum: 0, nullable: true },
    trackEndSec: { type: 'number', minimum: 0, nullable: true },
    loopStartSec: { type: 'number', minimum: 0, nullable: true },
    loopEndSec: { type: 'number', minimum: 0, nullable: true },
    loopMode: { type: 'string', enum: ['gapless', 'crossfade'], nullable: true },
    crossfadeSec: { type: 'number', minimum: 0, maximum: 10, nullable: true },
  },
} as const;

const mixBody = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string', nullable: true, maxLength: 500 },
    isPublic: { type: 'boolean' },
    illustration: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'icon', 'image'] },
        iconId: { type: 'string' },
        imageKey: { type: 'string' },
      },
    },
    items: { type: 'array', items: itemBody },
    sceneIds: { type: 'array', items: { type: 'string' } },
    ...taggedBody,
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'Mix ID' },
  },
} as const;

export interface MixView {
  access: Access;
  ownerName: string;
  sceneIds: string[];
  /** The viewer's own volumes by sound id, for a mix they did not create. */
  volumes?: Map<string, number>;
  synonyms: ItemSynonym[];
  categoryIds: string[];
}

/** Fields a user who added the mix from the library may change. */
const ADDED_FIELDS = new Set(['sceneIds', 'synonyms', 'categoryIds']);

function toItem(row: ItemRow, volume: number | undefined): MixItem {
  return {
    id: row.id,
    soundId: row.soundId,
    mode: row.mode,
    volume: volume ?? row.volume,
    intervalMinSec: row.intervalMinSec,
    intervalMaxSec: row.intervalMaxSec,
    volumeVariation: row.volumeVariation,
    trackStartSec: row.trackStartSec,
    trackEndSec: row.trackEndSec,
    loopStartSec: row.loopStartSec,
    loopEndSec: row.loopEndSec,
    loopMode: row.loopMode,
    crossfadeSec: row.crossfadeSec,
  };
}

export function toMix(row: CountedMix, items: ItemRow[], view: MixView): Mix {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isPublic: row.isPublic,
    access: view.access,
    addedCount: row.addedCount,
    ownerName: view.ownerName,
    illustration: toIllustration(row),
    items: items.map((item) => toItem(item, view.volumes?.get(item.soundId))),
    sceneIds: view.sceneIds,
    synonyms: view.synonyms,
    categoryIds: view.categoryIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function itemsOf(mixId: string): ItemRow[] {
  return db.select().from(mixItems).where(eq(mixItems.mixId, mixId)).orderBy(mixItems.position).all();
}

/** Items of several mixes, grouped by mix, in order. */
export function itemsByMix(mixIds: string[]): Map<string, ItemRow[]> {
  const map = new Map<string, ItemRow[]>();
  if (mixIds.length === 0) return map;
  const rows = db
    .select()
    .from(mixItems)
    .where(inArray(mixItems.mixId, mixIds))
    .orderBy(mixItems.position)
    .all();
  for (const item of rows) {
    const list = map.get(item.mixId);
    if (list) list.push(item);
    else map.set(item.mixId, [item]);
  }
  return map;
}

/** One mix as the user sees it. */
function mixFor(userId: string, row: CountedMix, access: Access): Mix {
  return toMix(row, itemsOf(row.id), {
    access,
    ownerName: ownerNames([row.ownerId]).get(row.ownerId) ?? '',
    sceneIds: sceneIdsByMix(userId).get(row.id) ?? [],
    volumes: access === 'owner' ? undefined : mixVolumesOf(userId).get(row.id),
    ...tagsOf('mix', userId, row.id, row.ownerId),
  });
}

/**
 * Turns the items of a request into rows: checks the limit, that the user can use each
 * sound and that it appears once, and fills missing settings from the sound's defaults.
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
  assertUsableSounds(user.id, soundIds, 'items');
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

  const ownVolumes = soundVolumesOf(user.id);

  return inputs.map((input, position) => {
    const sound = bySoundId.get(input.soundId)!;
    const intervalMinSec = input.intervalMinSec ?? sound.intervalMinSec;
    const intervalMaxSec = input.intervalMaxSec ?? sound.intervalMaxSec;
    if (intervalMinSec > intervalMaxSec) {
      throw invalid('Invalid request', {
        [`items.${position}.intervalMaxSec`]: 'Must not be below the minimum',
      });
    }
    // Loop markers left out stay null: the item then follows the sound's own values.
    const loopError = loopSettingsError(
      {
        durationSec: sound.durationSec,
        trackStartSec: input.trackStartSec ?? undefined,
        trackEndSec: input.trackEndSec ?? undefined,
        loopStartSec: input.loopStartSec ?? undefined,
        loopEndSec: input.loopEndSec ?? undefined,
        crossfadeSec: input.crossfadeSec ?? undefined,
      },
      {
        durationSec: sound.durationSec,
        trackStartSec: sound.trackStartSec,
        trackEndSec: sound.trackEndSec,
        loopStartSec: sound.loopStartSec,
        loopEndSec: sound.loopEndSec,
        crossfadeSec: sound.crossfadeSec,
      },
    );
    if (loopError) {
      throw invalid('Invalid request', {
        [`items.${position}.${loopError.field}`]: loopError.message,
      });
    }
    return {
      id: randomUUID(),
      mixId,
      soundId: sound.id,
      position,
      mode: input.mode ?? sound.defaultMode,
      volume: input.volume ?? ownVolumes.get(sound.id) ?? sound.defaultVolume,
      intervalMinSec,
      intervalMaxSec,
      volumeVariation: input.volumeVariation ?? sound.volumeVariation,
      trackStartSec: input.trackStartSec ?? null,
      trackEndSec: input.trackEndSec ?? null,
      loopStartSec: input.loopStartSec ?? null,
      loopEndSec: input.loopEndSec ?? null,
      loopMode: input.loopMode ?? null,
      crossfadeSec: input.crossfadeSec ?? null,
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
      description: 'Returns the mixes the user owns and the public mixes they added from the library.',
      response: {
        200: { type: 'array', items: mixResponse },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const added = addedMixIds(user.id);
    const rows = db
      .select(mixColumns)
      .from(mixes)
      .where(or(eq(mixes.ownerId, user.id), inArray(mixes.id, [...added])))
      .orderBy(mixes.name)
      .all();
    const items = itemsByMix(rows.map((r) => r.id));
    const sceneIds = sceneIdsByMix(user.id);
    const names = ownerNames(rows.map((r) => r.ownerId));
    const volumes = mixVolumesOf(user.id);
    const tags = tagsOfMany('mix', user.id, new Map(rows.map((r) => [r.id, r.ownerId])));
    return rows.map((row) => {
      const access: Access = row.ownerId === user.id ? 'owner' : 'added';
      return toMix(row, items.get(row.id) ?? [], {
        access,
        ownerName: names.get(row.ownerId) ?? '',
        sceneIds: sceneIds.get(row.id) ?? [],
        volumes: access === 'owner' ? undefined : volumes.get(row.id),
        ...tags(row.id),
      });
    });
  });

  app.get('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Get mix',
      description: 'Returns a single mix the user owns or added, with its items.',
      params: idParams,
      response: { 200: mixResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row, access } = usableMix(user.id, id);
    return mixFor(user.id, row, access);
  });

  app.post('/api/mixes', {
    schema: {
      tags: ['mixes'],
      summary: 'Create mix',
      description:
        'Creates a mix. Its sounds may be the user\'s own or added from the library; a public mix may only hold public sounds.',
      body: { ...mixBody, required: ['name'] },
      response: { 201: mixResponse },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const body = parse(createMixSchema, request.body);
    const id = randomUUID();
    const items = buildItems(user, id, body.items ?? []);
    if (body.isPublic) assertAllPublic(items.map((i) => i.soundId), 'items');
    if (body.sceneIds) assertOwned(scenes, user.id, body.sceneIds, 'sceneIds');
    if (body.categoryIds) assertOwnCategories(user.id, body.categoryIds);
    const illustration = body.illustration ? illustrationValues(body.illustration, user.id) : undefined;

    const now = new Date();
    const row = db.transaction(() => {
      const inserted = db
        .insert(mixes)
        .values({
          id,
          ownerId: user.id,
          name: body.name,
          description: body.description ?? null,
          isPublic: body.isPublic ?? false,
          ...illustration,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      replaceItems(id, items);
      if (body.sceneIds) setMixScenes(id, body.sceneIds);
      setTags('mix', user.id, id, body);
      return inserted;
    });
    return reply.code(201).send(mixFor(user.id, { ...row, addedCount: 0 }, 'owner'));
  });

  /**
   * `items`, when present, replaces the whole list. A user who added the mix from the
   * library may only send `sceneIds`.
   */
  app.patch('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Update mix',
      description:
        'Updates a mix. The owner may change every field; `items` replaces the whole list. A user who added the mix from the library may only change `sceneIds` (their own scenes), `synonyms` and `categoryIds` (their own).',
      params: idParams,
      body: mixBody,
      response: { 200: mixResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row: current, access } = usableMix(user.id, id);
    const body = parse(updateMixSchema, request.body);
    if (body.categoryIds) assertOwnCategories(user.id, body.categoryIds);

    if (access !== 'owner') {
      const sent = Object.keys(request.body as object);
      if (sent.some((key) => !ADDED_FIELDS.has(key))) {
        throw forbidden('Only the owner of this mix can change it');
      }
      if (body.sceneIds) assertOwned(scenes, user.id, body.sceneIds, 'sceneIds');
      db.transaction(() => {
        if (body.sceneIds) setMixScenes(current.id, body.sceneIds);
        setTags('mix', user.id, current.id, body);
      });
      return mixFor(user.id, current, access);
    }

    const items = body.items ? buildItems(user, current.id, body.items) : undefined;
    const willBePublic = body.isPublic ?? current.isPublic;
    if (willBePublic) {
      assertAllPublic((items ?? itemsOf(current.id)).map((i) => i.soundId), 'items');
    }
    if (body.sceneIds) assertOwned(scenes, user.id, body.sceneIds, 'sceneIds');
    const illustration = body.illustration ? illustrationValues(body.illustration, user.id) : undefined;

    const row = db.transaction(() => {
      if (items) replaceItems(current.id, items);
      if (body.sceneIds) setMixScenes(current.id, body.sceneIds);
      setTags('mix', user.id, current.id, body);
      return db
        .update(mixes)
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}),
          ...illustration,
          updatedAt: new Date(),
        })
        .where(eq(mixes.id, current.id))
        .returning()
        .get();
    });
    // Unpublishing, or dropping sounds that others only reached through this mix.
    if ((current.isPublic && !row.isPublic) || items) prune();
    if (illustration && current.imageKey !== row.imageKey) await releaseImages([current.imageKey]);
    // Unpublishing takes the mix out of everyone's library, so what it reports is 0.
    return mixFor(
      user.id,
      { ...row, addedCount: current.isPublic && !row.isPublic ? 0 : current.addedCount },
      'owner',
    );
  });

  app.put('/api/mixes/:id/volumes', {
    schema: {
      tags: ['mixes'],
      summary: 'Set my volumes in a mix',
      description:
        "For a mix added from the library: the user's own volume of each of its sounds, by sound id. The owner's volumes are kept. Replaces the volumes set before.",
      params: idParams,
      body: {
        type: 'object',
        required: ['volumes'],
        properties: {
          volumes: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
        },
      },
      response: { 200: mixResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row, access } = usableMix(user.id, id);
    if (access === 'owner') throw invalid('The owner sets volumes on the mix itself');
    const { volumes } = parse(mixVolumesSchema, request.body);
    const inMix = new Set(itemsOf(row.id).map((i) => i.soundId));
    const unknown = Object.keys(volumes).filter((soundId) => !inMix.has(soundId));
    if (unknown.length > 0) {
      throw invalid('Unknown id', { volumes: 'Contains a sound that is not in this mix' });
    }
    db.transaction(() => {
      db.delete(mixVolumes)
        .where(and(eq(mixVolumes.userId, user.id), eq(mixVolumes.mixId, row.id)))
        .run();
      const values = Object.entries(volumes).map(([soundId, volume]) => ({
        userId: user.id,
        mixId: row.id,
        soundId,
        volume,
      }));
      if (values.length > 0) db.insert(mixVolumes).values(values).run();
    });
    return mixFor(user.id, row, access);
  });

  /** Deletes the mix. A public mix is also taken out of every library that added it. */
  app.delete('/api/mixes/:id', {
    schema: {
      tags: ['mixes'],
      summary: 'Delete mix',
      description: 'Permanently deletes a mix. Its sounds are kept. Only its owner can.',
      params: idParams,
      response: {
        204: { type: 'null', description: 'Mix deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const { row, access } = usableMix(user.id, id);
    if (access !== 'owner') throw forbidden('Only the owner of this mix can delete it');
    db.delete(mixes).where(eq(mixes.id, row.id)).run();
    prune();
    await releaseImages([row.imageKey]);
    return reply.code(204).send();
  });
}

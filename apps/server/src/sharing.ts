/**
 * Public sounds and mixes, the libraries of the users who added them, and the images
 * items share.
 *
 * A user can use a sound they own, a public sound they added, and every sound of a public
 * mix they added. Making an item private or deleting it takes it away from everyone else
 * at once: `prune()` removes whatever no longer has access behind it.
 */
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { Access } from '@dnd/shared';
import { db, sqlite } from './db/index.js';
import {
  images,
  libraryMixes,
  librarySounds,
  mixVolumes,
  mixes,
  scenes,
  soundLoops,
  soundVolumes,
  sounds,
  users,
} from './db/schema.js';
import { invalid, notFound } from './errors.js';
import { imagePath, removeFile } from './storage.js';

type SoundRow = typeof sounds.$inferSelect;
type MixRow = typeof mixes.$inferSelect;

/** A sound row as every query here brings it back: the sound, plus its added count. */
export type CountedSound = SoundRow & { addedCount: number };
export type CountedMix = MixRow & { addedCount: number };

/**
 * How many other users have the item in their library, counted by the database inside the query
 * that fetches the item itself: one number per row, and no second query to chase it. The owner
 * is never counted, so the number only ever reads other users.
 */
export const soundAddedCount =
  sql<number>`(select count(*) from ${librarySounds} where ${librarySounds.soundId} = ${sounds.id} and ${librarySounds.userId} <> ${sounds.ownerId})`;
export const mixAddedCount =
  sql<number>`(select count(*) from ${libraryMixes} where ${libraryMixes.mixId} = ${mixes.id} and ${libraryMixes.userId} <> ${mixes.ownerId})`;

/** A sound row as every query here brings it back, count included. */
export const soundColumns = { ...getTableColumns(sounds), addedCount: soundAddedCount };
export const mixColumns = { ...getTableColumns(mixes), addedCount: mixAddedCount };

/**
 * True when user `:u` can use sound `:s`: owns it, or reached it through their library.
 * The `cu_` aliases keep the inner tables apart from those of the enclosing query.
 */
const CAN_USE_SOUND = `
  EXISTS (
    SELECT 1 FROM sounds cu_s WHERE cu_s.id = :s AND (
      cu_s.ownerId = :u OR (cu_s.isPublic = 1 AND (
        EXISTS (
          SELECT 1 FROM library_sounds cu_ls
          WHERE cu_ls.userId = :u AND cu_ls.soundId = cu_s.id
        )
        OR EXISTS (
          SELECT 1 FROM library_mixes cu_lm JOIN mix_items cu_mi ON cu_mi.mixId = cu_lm.mixId
          WHERE cu_lm.userId = :u AND cu_mi.soundId = cu_s.id
        )
        OR EXISTS (
          SELECT 1 FROM library_mixes cu_lp
            JOIN mix_playlists cu_mp ON cu_mp.mixId = cu_lp.mixId
            JOIN mixes cu_pl ON cu_pl.id = cu_mp.playlistId AND cu_pl.isPublic = 1
            JOIN mix_items cu_pi ON cu_pi.mixId = cu_mp.playlistId
          WHERE cu_lp.userId = :u AND cu_pi.soundId = cu_s.id
        )
      ))
    )
  )`;

const canUseSound = (user: string, sound: string) =>
  CAN_USE_SOUND.replaceAll(':u', user).replaceAll(':s', sound);

/**
 * True when user `:u` can use mix `:m`: owns it, added it, or added a mix that holds it (a
 * playlist inside a mix comes with the mix, like its sounds). Playlists hold no playlists,
 * so this goes one level deep and never chains.
 */
const CAN_USE_MIX = `
  EXISTS (
    SELECT 1 FROM mixes cm_m WHERE cm_m.id = :m AND (
      cm_m.ownerId = :u OR (cm_m.isPublic = 1 AND (
        EXISTS (
          SELECT 1 FROM library_mixes cm_lm WHERE cm_lm.userId = :u AND cm_lm.mixId = cm_m.id
        )
        OR EXISTS (
          SELECT 1 FROM library_mixes cm_lh JOIN mix_playlists cm_mp ON cm_mp.mixId = cm_lh.mixId
          WHERE cm_lh.userId = :u AND cm_mp.playlistId = cm_m.id
        )
      ))
    )
  )`;

const canUseMix = (user: string, mix: string) =>
  CAN_USE_MIX.replaceAll(':u', user).replaceAll(':m', mix);

const PRUNE_STATEMENTS = [
  `DELETE FROM library_sounds WHERE soundId IN (SELECT id FROM sounds WHERE isPublic = 0)`,
  `DELETE FROM library_mixes WHERE mixId IN (SELECT id FROM mixes WHERE isPublic = 0)`,
  // A public mix holds public sounds and playlists only: one made private leaves it, and the
  // mix stays public. Its owner's own public mixes are no exception.
  `DELETE FROM mix_items
   WHERE EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_items.mixId AND m.isPublic = 1)
     AND EXISTS (SELECT 1 FROM sounds s WHERE s.id = mix_items.soundId AND s.isPublic = 0)`,
  `DELETE FROM mix_playlists
   WHERE EXISTS (SELECT 1 FROM mixes m WHERE m.id = mix_playlists.mixId AND m.isPublic = 1)
     AND EXISTS (SELECT 1 FROM mixes p WHERE p.id = mix_playlists.playlistId AND p.isPublic = 0)`,
  `DELETE FROM mix_items WHERE NOT ${canUseSound(
    '(SELECT ownerId FROM mixes WHERE mixes.id = mix_items.mixId)',
    'mix_items.soundId',
  )}`,
  `DELETE FROM scene_sounds WHERE NOT ${canUseSound(
    '(SELECT ownerId FROM scenes WHERE scenes.id = scene_sounds.sceneId)',
    'scene_sounds.soundId',
  )}`,
  `DELETE FROM scene_mixes WHERE NOT ${canUseMix(
    '(SELECT ownerId FROM scenes WHERE scenes.id = scene_mixes.sceneId)',
    'scene_mixes.mixId',
  )}`,
  // Playlists in a mix its owner can no longer use, or that are not playlists.
  `DELETE FROM mix_playlists WHERE NOT ${canUseMix(
    '(SELECT ownerId FROM mixes WHERE mixes.id = mix_playlists.mixId)',
    'mix_playlists.playlistId',
  )} OR NOT EXISTS (
     SELECT 1 FROM mixes p WHERE p.id = mix_playlists.playlistId AND p.kind = 'playlist'
   )`,
  `DELETE FROM sound_volumes WHERE NOT ${canUseSound('sound_volumes.userId', 'sound_volumes.soundId')}`,
  `DELETE FROM sound_loops WHERE NOT ${canUseSound('sound_loops.userId', 'sound_loops.soundId')}`,
  `DELETE FROM mix_volumes WHERE NOT EXISTS (
     SELECT 1 FROM library_mixes lm
     WHERE lm.userId = mix_volumes.userId AND lm.mixId = mix_volumes.mixId
   )`,
  // Synonyms and categories a user set on an item they can no longer use.
  ...(['synonym', 'category'] as const).flatMap((tag) => {
    const tags = tag === 'synonym' ? 'synonyms' : 'categories';
    const owner = (links: string) =>
      `(SELECT ownerId FROM ${tags} WHERE ${tags}.id = ${links}.${tag}Id)`;
    return [
      `DELETE FROM sound_${tags} WHERE NOT ${canUseSound(owner(`sound_${tags}`), `sound_${tags}.soundId`)}`,
      `DELETE FROM mix_${tags} WHERE NOT ${canUseMix(owner(`mix_${tags}`), `mix_${tags}.mixId`)}`,
      `DELETE FROM scene_${tags} WHERE NOT EXISTS (
         SELECT 1 FROM scenes sc
         WHERE sc.id = scene_${tags}.sceneId AND sc.ownerId = ${owner(`scene_${tags}`)}
       )`,
    ];
  }),
  `DELETE FROM synonyms
   WHERE NOT EXISTS (SELECT 1 FROM sound_synonyms l WHERE l.synonymId = synonyms.id)
     AND NOT EXISTS (SELECT 1 FROM mix_synonyms l WHERE l.synonymId = synonyms.id)
     AND NOT EXISTS (SELECT 1 FROM scene_synonyms l WHERE l.synonymId = synonyms.id)`,
];

/**
 * Removes every link to a sound or mix its user can no longer use: library entries of
 * private items, items of mixes, scene members and personal volumes. Removing a mix item
 * can take away access to a sound in turn, hence the repeat until nothing changes.
 */
export function prune() {
  const statements = PRUNE_STATEMENTS.map((s) => sqlite.prepare(s));
  sqlite.transaction(() => {
    for (let round = 0; round < 10; round++) {
      let changes = 0;
      for (const statement of statements) changes += statement.run().changes;
      if (changes === 0) return;
    }
  })();
}

/** Ids of the sounds the user did not upload but can use. */
export function addedSoundIds(userId: string): Set<string> {
  const rows = sqlite
    .prepare(
      `SELECT s.id FROM sounds s WHERE s.ownerId != @u AND ${canUseSound('@u', 's.id')}`,
    )
    .all({ u: userId }) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Ids of the public mixes the user added, and of the playlists inside those. */
export function addedMixIds(userId: string): Set<string> {
  const rows = sqlite
    .prepare(`SELECT m.id FROM mixes m WHERE m.ownerId != @u AND ${canUseMix('@u', 'm.id')}`)
    .all({ u: userId }) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Checks that every id is a playlist the user can use, for a mix to hold. A playlist holds
 * no playlists, so this is only asked of a mix.
 */
export function assertUsablePlaylists(userId: string, ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw invalid('Invalid request', { [field]: 'A playlist can appear only once in a mix' });
  }
  if (unique.length === 0) return;
  const added = addedMixIds(userId);
  const rows = db
    .select({ id: mixes.id, ownerId: mixes.ownerId, kind: mixes.kind })
    .from(mixes)
    .where(inArray(mixes.id, unique))
    .all();
  const ok = rows.filter(
    (r) => r.kind === 'playlist' && (r.ownerId === userId || added.has(r.id)),
  );
  if (ok.length !== unique.length) {
    throw invalid('Unknown id', { [field]: 'Contains an id that is not one of your playlists' });
  }
}

/** A public mix may only hold public playlists, so everyone who adds it hears all of it. */
export function assertPublicPlaylists(ids: string[], field: string) {
  if (ids.length === 0) return;
  const privateOnes = db
    .select({ id: mixes.id })
    .from(mixes)
    .where(and(inArray(mixes.id, ids), eq(mixes.isPublic, false)))
    .all();
  if (privateOnes.length > 0) {
    throw invalid('A public mix can only hold public playlists', {
      [field]: 'Make these playlists public first, or keep the mix private',
    });
  }
}

/** Ids of the public sounds the user added one by one (not through a mix). */
export function directlyAddedSoundIds(userId: string): Set<string> {
  return new Set(
    db
      .select({ id: librarySounds.soundId })
      .from(librarySounds)
      .where(eq(librarySounds.userId, userId))
      .all()
      .map((r) => r.id),
  );
}

/** Account names by id, for "owned by" labels. */
export function ownerNames(ids: Iterable<string>): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, unique))
      .all()
      .map((r) => [r.id, r.name]),
  );
}

/** The user's own volume for each sound they did not upload. */
export function soundVolumesOf(userId: string): Map<string, number> {
  return new Map(
    db
      .select({ id: soundVolumes.soundId, volume: soundVolumes.volume })
      .from(soundVolumes)
      .where(eq(soundVolumes.userId, userId))
      .all()
      .map((r) => [r.id, r.volume]),
  );
}

/** Loop fields shared by sounds, mix items and a user's own loop settings. */
export type LoopFields = Pick<
  SoundRow,
  'trackStartSec' | 'trackEndSec' | 'loopStartSec' | 'loopEndSec' | 'crossfadeSec'
>;

/** The user's own loop settings for sounds they did not upload, by sound id. */
export function soundLoopsOf(userId: string): Map<string, LoopFields> {
  return new Map(
    db
      .select({
        soundId: soundLoops.soundId,
        trackStartSec: soundLoops.trackStartSec,
        trackEndSec: soundLoops.trackEndSec,
        loopStartSec: soundLoops.loopStartSec,
        loopEndSec: soundLoops.loopEndSec,
        crossfadeSec: soundLoops.crossfadeSec,
      })
      .from(soundLoops)
      .where(eq(soundLoops.userId, userId))
      .all()
      .map(({ soundId, ...loop }) => [soundId, loop]),
  );
}

/** The owner's loop settings of the given sounds, with their length, by sound id. */
export function ownerLoopsOf(
  soundIds: string[],
): Map<string, LoopFields & { durationSec: number }> {
  if (soundIds.length === 0) return new Map();
  return new Map(
    db
      .select({
        id: sounds.id,
        durationSec: sounds.durationSec,
        trackStartSec: sounds.trackStartSec,
        trackEndSec: sounds.trackEndSec,
        loopStartSec: sounds.loopStartSec,
        loopEndSec: sounds.loopEndSec,
        crossfadeSec: sounds.crossfadeSec,
      })
      .from(sounds)
      .where(inArray(sounds.id, soundIds))
      .all()
      .map(({ id, ...loop }) => [id, loop]),
  );
}

/** The user's own volumes inside mixes they added: mix id, then sound id. */
export function mixVolumesOf(userId: string): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of db.select().from(mixVolumes).where(eq(mixVolumes.userId, userId)).all()) {
    const forMix = map.get(row.mixId) ?? new Map<string, number>();
    forMix.set(row.soundId, row.volume);
    map.set(row.mixId, forMix);
  }
  return map;
}

/** A sound the user owns or added, with that relation. Anything else is "not found". */
export function usableSound(
  userId: string,
  id: string,
): { row: CountedSound; access: Access } {
  const row = db.select(soundColumns).from(sounds).where(eq(sounds.id, id)).get();
  if (row?.ownerId === userId) return { row, access: 'owner' };
  if (row && addedSoundIds(userId).has(row.id)) return { row, access: 'added' };
  throw notFound('Sound');
}

/** A mix the user owns or added, with that relation. Anything else is "not found". */
export function usableMix(
  userId: string,
  id: string,
): { row: CountedMix; access: Access } {
  const row = db.select(mixColumns).from(mixes).where(eq(mixes.id, id)).get();
  if (row?.ownerId === userId) return { row, access: 'owner' };
  if (row && addedMixIds(userId).has(row.id)) return { row, access: 'added' };
  throw notFound('Mix');
}

/**
 * Checks that the user can use every sound id. Ids of sounds they cannot use are
 * reported exactly like ids that do not exist.
 */
export function assertUsableSounds(userId: string, ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const own = new Set(
    db
      .select({ id: sounds.id })
      .from(sounds)
      .where(and(eq(sounds.ownerId, userId), inArray(sounds.id, unique)))
      .all()
      .map((r) => r.id),
  );
  const added = addedSoundIds(userId);
  if (!unique.every((id) => own.has(id) || added.has(id))) {
    throw invalid('Unknown id', { [field]: 'Contains an id that does not exist' });
  }
}

/** Checks that the user owns or added every mix id. */
export function assertUsableMixes(userId: string, ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const own = new Set(
    db
      .select({ id: mixes.id })
      .from(mixes)
      .where(and(eq(mixes.ownerId, userId), inArray(mixes.id, unique)))
      .all()
      .map((r) => r.id),
  );
  const added = addedMixIds(userId);
  if (!unique.every((id) => own.has(id) || added.has(id))) {
    throw invalid('Unknown id', { [field]: 'Contains an id that does not exist' });
  }
}

/** A public mix may only hold public sounds, so everyone who adds it can play all of it. */
export function assertAllPublic(soundIds: string[], field: string) {
  const unique = [...new Set(soundIds)];
  if (unique.length === 0) return;
  const privateOnes = db
    .select({ id: sounds.id })
    .from(sounds)
    .where(and(inArray(sounds.id, unique), eq(sounds.isPublic, false)))
    .all();
  if (privateOnes.length > 0) {
    throw invalid('A public mix can only hold public sounds', {
      [field]: 'Make these sounds public first, or keep the mix private',
    });
  }
}

// Images

/** Keys of the images the user may put on their items: theirs, and those of items they can use. */
export function usableImageKeys(userId: string): string[] {
  const rows = sqlite
    .prepare(
      `SELECT key FROM images WHERE ownerId = @u
       UNION SELECT imageKey FROM sounds WHERE imageKey IS NOT NULL AND ownerId = @u
       UNION SELECT imageKey FROM mixes WHERE imageKey IS NOT NULL AND ownerId = @u
       UNION SELECT imageKey FROM scenes WHERE imageKey IS NOT NULL AND ownerId = @u
       UNION SELECT s.imageKey FROM sounds s WHERE s.imageKey IS NOT NULL
         AND ${canUseSound('@u', 's.id')}
       UNION SELECT m.imageKey FROM mixes m JOIN library_mixes lm ON lm.mixId = m.id
         WHERE m.imageKey IS NOT NULL AND lm.userId = @u`,
    )
    .all({ u: userId }) as { key: string }[];
  const keys = rows.map((r) => r.key);
  if (keys.length === 0) return [];
  const known = db
    .select({ key: images.key, createdAt: images.createdAt })
    .from(images)
    .where(inArray(images.key, keys))
    .all();
  return known.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => r.key);
}

/** The stored image behind a key the user is allowed to reuse. */
export function reusableImage(userId: string, key: string) {
  const row = db.select().from(images).where(eq(images.key, key)).get();
  if (!row || !usableImageKeys(userId).includes(key)) {
    throw invalid('Unknown image', { 'illustration.imageKey': 'Unknown image' });
  }
  return row;
}

/**
 * Whether the user may see an image: they uploaded it, one of their items shows it, or a
 * public item shows it.
 */
export function canSeeImage(userId: string, key: string): boolean {
  const row = db.select({ ownerId: images.ownerId }).from(images).where(eq(images.key, key)).get();
  if (!row) return false;
  if (row.ownerId === userId) return true;
  const shown = sqlite
    .prepare(
      `SELECT 1 FROM sounds WHERE imageKey = @k AND (ownerId = @u OR isPublic = 1)
       UNION ALL SELECT 1 FROM mixes WHERE imageKey = @k AND (ownerId = @u OR isPublic = 1)
       UNION ALL SELECT 1 FROM scenes WHERE imageKey = @k AND ownerId = @u LIMIT 1`,
    )
    .get({ k: key, u: userId });
  return shown !== undefined;
}

/** File path of a stored image, or null when the key is unknown. */
export function storedImagePath(key: string): string | null {
  const row = db.select({ ownerId: images.ownerId }).from(images).where(eq(images.key, key)).get();
  return row ? imagePath(row.ownerId, key) : null;
}

/** Deletes the images no item shows anymore, rows and files. */
export async function releaseImages(keys: (string | null | undefined)[]) {
  for (const key of new Set(keys)) {
    if (!key) continue;
    const used = sqlite
      .prepare(
        `SELECT 1 FROM sounds WHERE imageKey = @k
         UNION ALL SELECT 1 FROM mixes WHERE imageKey = @k
         UNION ALL SELECT 1 FROM scenes WHERE imageKey = @k LIMIT 1`,
      )
      .get({ k: key });
    if (used) continue;
    const path = storedImagePath(key);
    db.delete(images).where(eq(images.key, key)).run();
    if (path) await removeFile(path);
  }
}

/**
 * Before an account is deleted: items of other accounts that show one of its images go
 * back to no illustration, since the files are about to go.
 */
export function detachImagesOf(userId: string) {
  const keys = sql`(SELECT key FROM images WHERE ownerId = ${userId})`;
  const cleared = { illustrationType: 'none' as const, imageKey: null, imageBytes: 0 };
  for (const table of [sounds, mixes, scenes]) {
    db.update(table)
      .set(cleared)
      .where(and(sql`${table.imageKey} IN ${keys}`, sql`${table.ownerId} != ${userId}`))
      .run();
  }
}

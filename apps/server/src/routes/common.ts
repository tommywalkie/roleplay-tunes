import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { mixes, sceneMixes, sceneSounds, scenes, sounds } from '../db/schema.js';
import { invalid } from '../errors.js';

type OwnedTable = typeof sounds | typeof mixes | typeof scenes;

/**
 * Checks that every id belongs to the user. Ids of other users
 * are reported exactly like ids that do not exist.
 */
export function assertOwned(table: OwnedTable, userId: string, ids: string[], field: string) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.ownerId, userId), inArray(table.id, unique)))
    .all();
  if (found.length !== unique.length) {
    throw invalid('Unknown id', { [field]: 'Contains an id that does not exist' });
  }
}

/** Scene ids of each sound of a user. */
export function sceneIdsBySound(userId: string): Map<string, string[]> {
  const rows = db
    .select({ sceneId: sceneSounds.sceneId, id: sceneSounds.soundId })
    .from(sceneSounds)
    .innerJoin(scenes, eq(scenes.id, sceneSounds.sceneId))
    .where(eq(scenes.ownerId, userId))
    .orderBy(scenes.position)
    .all();
  return group(rows);
}

/** Scene ids of each mix of a user. */
export function sceneIdsByMix(userId: string): Map<string, string[]> {
  const rows = db
    .select({ sceneId: sceneMixes.sceneId, id: sceneMixes.mixId })
    .from(sceneMixes)
    .innerJoin(scenes, eq(scenes.id, sceneMixes.sceneId))
    .where(eq(scenes.ownerId, userId))
    .orderBy(scenes.position)
    .all();
  return group(rows);
}

function group(rows: { sceneId: string; id: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.id);
    if (list) list.push(row.sceneId);
    else map.set(row.id, [row.sceneId]);
  }
  return map;
}

/** Replaces the scenes a sound belongs to. The ids must already be checked for ownership. */
export function setSoundScenes(soundId: string, sceneIds: string[]) {
  db.delete(sceneSounds).where(eq(sceneSounds.soundId, soundId)).run();
  const unique = [...new Set(sceneIds)];
  if (unique.length > 0) {
    db.insert(sceneSounds)
      .values(unique.map((sceneId) => ({ sceneId, soundId })))
      .run();
  }
}

/** Replaces the scenes a mix belongs to. The ids must already be checked for ownership. */
export function setMixScenes(mixId: string, sceneIds: string[]) {
  db.delete(sceneMixes).where(eq(sceneMixes.mixId, mixId)).run();
  const unique = [...new Set(sceneIds)];
  if (unique.length > 0) {
    db.insert(sceneMixes)
      .values(unique.map((sceneId) => ({ sceneId, mixId })))
      .run();
  }
}

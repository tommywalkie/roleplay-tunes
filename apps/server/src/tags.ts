/**
 * Synonyms and categories on sounds, mixes and scenes.
 *
 * Both belong to the user who wrote them. A user puts theirs on any item they own or
 * added; on an item they see the owner's synonyms and their own, and only their own
 * categories. Nobody changes or removes what another user set. A synonym no item carries
 * anymore is deleted; a category stays until its owner deletes it.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { ItemSynonym } from '@dnd/shared';
import { db, sqlite } from './db/index.js';
import {
  categories,
  mixCategories,
  mixSynonyms,
  sceneCategories,
  sceneSynonyms,
  soundCategories,
  soundSynonyms,
  synonyms,
} from './db/schema.js';
import { invalid } from './errors.js';

export type ItemKind = 'sound' | 'mix' | 'scene';

const SYNONYM_LINKS = { sound: soundSynonyms, mix: mixSynonyms, scene: sceneSynonyms };
const CATEGORY_LINKS = { sound: soundCategories, mix: mixCategories, scene: sceneCategories };

/** Deletes the synonyms no item carries, of one user or of everyone. */
const UNUSED_SYNONYMS = `
  DELETE FROM synonyms WHERE (@owner IS NULL OR ownerId = @owner)
    AND NOT EXISTS (SELECT 1 FROM sound_synonyms l WHERE l.synonymId = synonyms.id)
    AND NOT EXISTS (SELECT 1 FROM mix_synonyms l WHERE l.synonymId = synonyms.id)
    AND NOT EXISTS (SELECT 1 FROM scene_synonyms l WHERE l.synonymId = synonyms.id)`;

export function deleteUnusedSynonyms(ownerId: string | null = null) {
  sqlite.prepare(UNUSED_SYNONYMS).run({ owner: ownerId });
}

/**
 * The synonyms the viewer sees on each item: the item owner's and their own, each text
 * once, sorted. `owners` maps each item id to its owner's id.
 */
export function synonymsByItem(
  kind: ItemKind,
  viewerId: string,
  owners: Map<string, string>,
): Map<string, ItemSynonym[]> {
  const ids = [...owners.keys()];
  if (ids.length === 0) return new Map();
  const link = SYNONYM_LINKS[kind];
  const rows = db
    .select({ itemId: link.itemId, label: synonyms.label, ownerId: synonyms.ownerId })
    .from(link)
    .innerJoin(synonyms, eq(synonyms.id, link.tagId))
    .where(inArray(link.itemId, ids))
    .all();
  const seen = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const mine = row.ownerId === viewerId;
    if (!mine && row.ownerId !== owners.get(row.itemId)) continue;
    const labels = seen.get(row.itemId) ?? new Map<string, boolean>();
    labels.set(row.label, (labels.get(row.label) ?? false) || mine);
    seen.set(row.itemId, labels);
  }
  return new Map(
    [...seen].map(([itemId, labels]) => [
      itemId,
      [...labels]
        .map(([label, mine]) => ({ label, mine }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ]),
  );
}

/** The viewer's own category ids on each item, sorted by category name. */
export function categoryIdsByItem(
  kind: ItemKind,
  viewerId: string,
  itemIds: string[],
): Map<string, string[]> {
  if (itemIds.length === 0) return new Map();
  const link = CATEGORY_LINKS[kind];
  const rows = db
    .select({ itemId: link.itemId, id: categories.id })
    .from(link)
    .innerJoin(categories, eq(categories.id, link.tagId))
    .where(and(eq(categories.ownerId, viewerId), inArray(link.itemId, itemIds)))
    .orderBy(categories.name)
    .all();
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.itemId, [...(map.get(row.itemId) ?? []), row.id]);
  return map;
}

/** Synonyms and categories of one item, as the viewer sees them. */
export function tagsOf(kind: ItemKind, viewerId: string, itemId: string, ownerId: string) {
  return {
    synonyms: synonymsByItem(kind, viewerId, new Map([[itemId, ownerId]])).get(itemId) ?? [],
    categoryIds: categoryIdsByItem(kind, viewerId, [itemId]).get(itemId) ?? [],
  };
}

/** Synonyms and categories of many items, as the viewer sees them. */
export function tagsOfMany(kind: ItemKind, viewerId: string, owners: Map<string, string>) {
  const synonymMap = synonymsByItem(kind, viewerId, owners);
  const categoryMap = categoryIdsByItem(kind, viewerId, [...owners.keys()]);
  return (itemId: string) => ({
    synonyms: synonymMap.get(itemId) ?? [],
    categoryIds: categoryMap.get(itemId) ?? [],
  });
}

/** Checks that every category id belongs to the user, before anything is written. */
export function assertOwnCategories(userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.ownerId, userId), inArray(categories.id, unique)))
    .all();
  if (found.length !== unique.length) {
    throw invalid('Unknown id', { categoryIds: 'Contains an id that does not exist' });
  }
}

/**
 * Replaces the user's own synonyms and categories on an item, for each list that is
 * given. Category ids must be checked with `assertOwnCategories` first. Run it inside the
 * item's own transaction.
 */
export function setTags(
  kind: ItemKind,
  userId: string,
  itemId: string,
  tags: { synonyms?: string[]; categoryIds?: string[] },
) {
  if (tags.synonyms) {
    const link = SYNONYM_LINKS[kind];
    const own = db.select({ id: synonyms.id }).from(synonyms).where(eq(synonyms.ownerId, userId));
    db.delete(link).where(and(eq(link.itemId, itemId), inArray(link.tagId, own))).run();
    const labels = [...new Set(tags.synonyms)];
    if (labels.length > 0) {
      db.insert(synonyms)
        .values(labels.map((label) => ({ id: randomUUID(), ownerId: userId, label })))
        .onConflictDoNothing()
        .run();
      const ids = db
        .select({ id: synonyms.id })
        .from(synonyms)
        .where(and(eq(synonyms.ownerId, userId), inArray(synonyms.label, labels)))
        .all();
      db.insert(link)
        .values(ids.map((row) => ({ tagId: row.id, itemId })))
        .run();
    }
    deleteUnusedSynonyms(userId);
  }
  if (tags.categoryIds) {
    const link = CATEGORY_LINKS[kind];
    const own = db.select({ id: categories.id }).from(categories).where(eq(categories.ownerId, userId));
    db.delete(link).where(and(eq(link.itemId, itemId), inArray(link.tagId, own))).run();
    const ids = [...new Set(tags.categoryIds)];
    if (ids.length > 0) {
      db.insert(link)
        .values(ids.map((tagId) => ({ tagId, itemId })))
        .run();
    }
  }
}

/** Every synonym the user has on their items, sorted, for suggestions while typing. */
export function synonymsOf(userId: string): string[] {
  return db
    .select({ label: synonyms.label })
    .from(synonyms)
    .where(eq(synonyms.ownerId, userId))
    .orderBy(synonyms.label)
    .all()
    .map((row) => row.label);
}

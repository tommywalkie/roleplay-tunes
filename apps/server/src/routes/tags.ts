import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CATEGORIES_PER_USER,
  createCategorySchema,
  updateCategorySchema,
  type Category,
} from '@dnd/shared';
import { requireUser } from '../auth.js';
import { db } from '../db/index.js';
import { categories } from '../db/schema.js';
import { conflict, invalid, notFound, parse } from '../errors.js';
import { resolveIconSvg } from '../illustrations.js';
import { synonymsOf } from '../tags.js';

/**
 * Response fields every sound, mix and scene carries. Listed so the response schema keeps
 * them: Fastify drops properties a response schema does not name.
 */
export const taggedResponse = {
  synonyms: {
    type: 'array',
    description: "The item owner's synonyms and the caller's own. `mine`: the caller may remove it.",
    items: {
      type: 'object',
      properties: { label: { type: 'string' }, mine: { type: 'boolean' } },
    },
  },
  categoryIds: {
    type: 'array',
    description: "The caller's own categories on the item.",
    items: { type: 'string' },
  },
} as const;

/** Body fields every user who has the item may send: their own synonyms and categories. */
export const taggedBody = {
  synonyms: {
    type: 'array',
    description:
      "The caller's own synonyms on the item, replacing theirs. 1 to 40 characters each, up to 30; the same text twice is kept once.",
    items: { type: 'string' },
  },
  categoryIds: {
    type: 'array',
    description: "The caller's own categories on the item, replacing theirs.",
    items: { type: 'string' },
  },
} as const;

const categoryResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: { type: 'string', description: 'Background color, `#rrggbb`' },
    icon: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: '`{ iconId, svg }`, or null',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
} as const;

const categoryBody = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 40 },
    color: { type: 'string', description: '`#rrggbb`' },
    iconId: { type: 'string', nullable: true, description: 'An icon id such as `tabler:door`, or null' },
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', description: 'Category ID' } },
} as const;

type CategoryRow = typeof categories.$inferSelect;

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color.toLowerCase(),
    icon: row.iconId && row.iconSvg ? { iconId: row.iconId, svg: row.iconSvg } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function ownCategory(userId: string, id: string): CategoryRow {
  const row = db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.ownerId, userId)))
    .get();
  if (!row) throw notFound('Category');
  return row;
}

function assertNameFree(userId: string, name: string, exceptId?: string) {
  const taken = db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.ownerId, userId), eq(categories.name, name)))
    .get();
  if (taken && taken.id !== exceptId) {
    throw conflict('You already have a category with this name', {
      name: 'You already have a category with this name',
    });
  }
}

/** Icon columns for an icon id, from the server's own copy of the icon sets. */
function iconValues(iconId: string | null) {
  if (iconId === null) return { iconId: null, iconSvg: null };
  try {
    return { iconId, iconSvg: resolveIconSvg(iconId) };
  } catch {
    throw invalid('Unknown icon', { iconId: 'Unknown icon' });
  }
}

export function tagsRoutes(app: FastifyInstance) {
  app.get('/api/synonyms', {
    schema: {
      tags: ['synonyms'],
      summary: 'List my synonyms',
      description:
        'Every synonym the user put on one of their items or on items they added, sorted. A synonym is deleted once no item carries it.',
      response: { 200: { type: 'array', items: { type: 'string' } } },
    },
  }, async (request) => {
    const user = await requireUser(request);
    return synonymsOf(user.id);
  });

  app.get('/api/categories', {
    schema: {
      tags: ['categories'],
      summary: 'List my categories',
      description: "The user's own categories, sorted by name.",
      response: { 200: { type: 'array', items: categoryResponse } },
    },
  }, async (request) => {
    const user = await requireUser(request);
    return db
      .select()
      .from(categories)
      .where(eq(categories.ownerId, user.id))
      .orderBy(categories.name)
      .all()
      .map(toCategory);
  });

  app.post('/api/categories', {
    schema: {
      tags: ['categories'],
      summary: 'Create category',
      description: `Creates a category. Names are unique per user (exact text), up to ${CATEGORIES_PER_USER} categories.`,
      body: { ...categoryBody, required: ['name', 'color'] },
      response: { 201: categoryResponse },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const body = parse(createCategorySchema, request.body);
    const count =
      db
        .select({ n: sql<number>`count(*)` })
        .from(categories)
        .where(eq(categories.ownerId, user.id))
        .get()?.n ?? 0;
    if (count >= CATEGORIES_PER_USER) {
      throw conflict(`Up to ${CATEGORIES_PER_USER} categories`);
    }
    assertNameFree(user.id, body.name);
    const row = db
      .insert(categories)
      .values({
        id: randomUUID(),
        ownerId: user.id,
        name: body.name,
        color: body.color,
        ...iconValues(body.iconId ?? null),
        createdAt: new Date(),
      })
      .returning()
      .get();
    return reply.code(201).send(toCategory(row));
  });

  app.patch('/api/categories/:id', {
    schema: {
      tags: ['categories'],
      summary: 'Update category',
      description: 'Changes the name, color or icon of one of the user\'s categories.',
      params: idParams,
      body: categoryBody,
      response: { 200: categoryResponse },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const current = ownCategory(user.id, id);
    const body = parse(updateCategorySchema, request.body);
    if (body.name !== undefined) assertNameFree(user.id, body.name, current.id);
    const row = db
      .update(categories)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.iconId !== undefined ? iconValues(body.iconId) : {}),
      })
      .where(eq(categories.id, current.id))
      .returning()
      .get();
    return toCategory(row);
  });

  app.delete('/api/categories/:id', {
    schema: {
      tags: ['categories'],
      summary: 'Delete category',
      description: 'Deletes one of the user\'s categories and takes it off every item.',
      params: idParams,
      response: { 204: { type: 'null', description: 'Category deleted' } },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const current = ownCategory(user.id, id);
    db.delete(categories).where(eq(categories.id, current.id)).run();
    return reply.code(204).send();
  });
}

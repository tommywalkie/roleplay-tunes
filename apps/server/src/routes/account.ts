import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  deleteMeSchema,
  roleSchema,
  updateMeSchema,
  type Me,
  type PublicSettings,
} from '@dnd/shared';
import { requireUser, type UserRow } from '../auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { invalid, parse } from '../errors.js';
import { effectiveLimits, signupsOpen, usageOf } from '../settings.js';
import { detachImagesOf, prune } from '../sharing.js';
import { removeUserFiles } from '../storage.js';

export function toMe(user: UserRow): Me {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: roleSchema.catch('user').parse(user.role),
    limits: effectiveLimits(user),
    usage: usageOf(user.id),
    termsAcceptedAt: user.termsAcceptedAt?.toISOString() ?? null,
  };
}

/** Removes a user, every row they own (by cascade) and every file they own. */
export async function deleteUser(userId: string): Promise<void> {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (user?.role === 'admin') {
    const adminCount = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, 'admin'))
      .get()?.count ?? 0;
    if (adminCount <= 1) {
      throw new Error('Cannot delete the last admin');
    }
  }
  detachImagesOf(userId);
  db.delete(users).where(eq(users.id, userId)).run();
  prune();
  await removeUserFiles(userId);
}

export function accountRoutes(app: FastifyInstance) {
  /** What the sign-in screen needs before anyone is signed in. */
  app.get('/api/settings/public', {
    schema: {
      tags: ['account'],
      summary: 'Public settings',
      description: 'Returns public settings such as whether sign-ups are open.',
      response: {
        200: {
          type: 'object',
          properties: {
            signupsOpen: { type: 'boolean' },
          },
        },
      },
    },
  }, async (): Promise<PublicSettings> => {
    return { signupsOpen: signupsOpen() };
  });

  app.get('/api/me', {
    schema: {
      tags: ['account'],
      summary: 'Current user',
      description: 'Returns the authenticated user profile and limits.',
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
            limits: { type: 'object', additionalProperties: true },
            usage: { type: 'object', additionalProperties: true },
            // Must be named or the serializer strips it, and the rules dialog never
            // closes: the client would read the acceptance as missing forever.
            termsAcceptedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  }, async (request) => toMe(await requireUser(request)));

  app.patch('/api/me', {
    schema: {
      tags: ['account'],
      summary: 'Update my account',
      description:
        'Changes the name the user goes by: the one shown on their shared sounds and mixes. 1 to 100 characters, no control characters.',
      body: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', maxLength: 100 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
            limits: { type: 'object', additionalProperties: true },
            usage: { type: 'object', additionalProperties: true },
            termsAcceptedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
  }, async (request) => {
    const user = await requireUser(request);
    const { name } = parse(updateMeSchema, request.body);
    const row = db
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning()
      .get();
    return toMe(row);
  });

  app.delete('/api/me', {
    schema: {
      tags: ['account'],
      summary: 'Delete account',
      description: 'Deletes the authenticated user account after confirming the email.',
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', description: 'Account email to confirm deletion' },
        },
      },
      response: {
        204: { type: 'null', description: 'Account deleted' },
      },
    },
  }, async (request, reply) => {
    const user = await requireUser(request);
    const { email } = parse(deleteMeSchema, request.body);
    if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw invalid('Invalid request', { email: 'Does not match the account email' });
    }
    await deleteUser(user.id);
    return reply.code(204).send();
  });
}

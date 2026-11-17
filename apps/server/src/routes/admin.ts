import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { roleSchema, type Usage } from '@dnd/shared';
import { z } from 'zod';
import type { UserRow } from '../auth.js';
import { requireAdmin } from '../auth.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { sessions, users, verifications, storageSnapshots } from '../db/schema.js';
import { invalid, parse } from '../errors.js';
import { defaultLimits, overrideColumn, setDefaultLimits, setSignupsOpen, signupsOpen, usageOf } from '../settings.js';
import { removeUserFiles } from '../storage.js';

type AdminUser = UserRow & { usage: Usage };

/** One hour to open the reset link and choose a new password. */
const RESET_TTL_SEC = 60 * 60;

// Disk usage: measured live, one snapshot per day kept for the chart.
interface DiskUsage {
  audioBytes: number;
  imageBytes: number;
  databaseBytes: number;
  freeBytes: number;
}

async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // The directory does not exist yet: nothing stored.
  }
  let total = 0;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(path);
    else {
      try {
        total += (await stat(path)).size;
      } catch {
        // A file that vanished between readdir and stat is simply not counted.
      }
    }
  }
  return total;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0; // ':memory:' in tests, or the database file not created yet.
  }
}

/** Space still available on the volume holding the data directory (0 when the OS does not say). */
async function freeBytes(dir: string): Promise<number> {
  try {
    const volume = await statfs(dir);
    return volume.bavail * volume.bsize;
  } catch {
    return 0;
  }
}

async function measureDisk(): Promise<DiskUsage> {
  const [audioBytes, imageBytes, databaseBytes, free] = await Promise.all([
    dirSize(config.audioDir),
    dirSize(config.imageDir),
    fileSize(config.databasePath),
    freeBytes(config.dataDir),
  ]);
  return { audioBytes, imageBytes, databaseBytes, freeBytes: free };
}

export function adminRoutes(app: FastifyInstance) {
  // Server settings (sign-ups open, default limits)
  app.get('/api/admin/settings', {
    schema: {
      tags: ['admin'],
      summary: 'Admin settings',
      description: 'Returns the current server settings (sign-ups status and default limits).',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            signupsOpen: { type: 'boolean' },
            defaults: {
              type: 'object',
              properties: {
                storageBytes: { type: 'integer' },
                audioFileBytes: { type: 'integer' },
                audioDurationSec: { type: 'integer' },
                imageFileBytes: { type: 'integer' },
                mixItems: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request);
    return { signupsOpen: signupsOpen(), defaults: defaultLimits() };
  });

  app.put('/api/admin/settings/signups', {
    schema: {
      tags: ['admin'],
      summary: 'Toggle sign-ups',
      description: 'Open or close user registration.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['open'],
        properties: {
          open: { type: 'boolean' },
        },
      },
      response: {
        204: { type: 'null', description: 'Setting updated' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { open } = parse(z.object({ open: z.boolean() }), request.body);
    setSignupsOpen(open);
    return reply.code(204).send();
  });

  app.put('/api/admin/settings/defaults', {
    schema: {
      tags: ['admin'],
      summary: 'Set default limits',
      description: 'Updates the default resource limits for new users.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['limits'],
        properties: {
          limits: {
            type: 'object',
            properties: {
              storageBytes: { type: 'integer', minimum: 0 },
              audioFileBytes: { type: 'integer', minimum: 0 },
              audioDurationSec: { type: 'integer', minimum: 0 },
              imageFileBytes: { type: 'integer', minimum: 0 },
              mixItems: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
      response: {
        204: { type: 'null', description: 'Defaults updated' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { limits } = parse(
      z.object({
        limits: z.object({
          storageBytes: z.number().int().min(0).optional(),
          audioFileBytes: z.number().int().min(0).optional(),
          audioDurationSec: z.number().int().min(0).optional(),
          imageFileBytes: z.number().int().min(0).optional(),
          mixItems: z.number().int().min(0).optional(),
        }),
      }),
      request.body,
    );
    setDefaultLimits(limits);
    return reply.code(204).send();
  });

  // User list and per-user actions
  app.get('/api/admin/users', {
    schema: {
      tags: ['admin'],
      summary: 'List users',
      description: 'Returns all users with their usage data.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              name: { type: 'string' },
              image: { type: 'string', nullable: true },
              role: { type: 'string', enum: ['user', 'admin'] },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time', nullable: true },
              emailVerified: { type: 'boolean', nullable: true },
              banned: { type: 'boolean', nullable: true },
              banReason: { type: 'string', nullable: true },
              banExpires: { type: 'string', format: 'date-time', nullable: true },
              lastActiveAt: { type: 'string', format: 'date-time', nullable: true },
              limitStorageBytes: { type: 'integer', nullable: true },
              limitAudioFileBytes: { type: 'integer', nullable: true },
              limitAudioDurationSec: { type: 'integer', nullable: true },
              limitImageFileBytes: { type: 'integer', nullable: true },
              limitMixItems: { type: 'integer', nullable: true },
              usage: {
                type: 'object',
                properties: {
                  storageBytes: { type: 'integer' },
                  sounds: { type: 'integer' },
                  mixes: { type: 'integer' },
                  scenes: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request);

    const rows = db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        image: users.image,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        emailVerified: users.emailVerified,
        banned: users.banned,
        banReason: users.banReason,
        banExpires: users.banExpires,
        lastActiveAt: users.lastActiveAt,
        limitStorageBytes: users.limitStorageBytes,
        limitAudioFileBytes: users.limitAudioFileBytes,
        limitAudioDurationSec: users.limitAudioDurationSec,
        limitImageFileBytes: users.limitImageFileBytes,
        limitMixItems: users.limitMixItems,
      })
      .from(users)
      .orderBy(users.createdAt)
      .all();

    const withUsage: AdminUser[] = await Promise.all(
      rows.map(async (u) => ({
        ...u,
        usage: usageOf(u.id),
      })),
    );

    return withUsage;
  });

  app.patch('/api/admin/users/:id/role', {
    schema: {
      tags: ['admin'],
      summary: 'Change user role',
      description: 'Promote or demote a user.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      },
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['user', 'admin'] },
        },
      },
      response: {
        204: { type: 'null', description: 'Role updated' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { role } = parse(z.object({ role: roleSchema }), request.body);

    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) throw invalid('User not found');

    if (existing.role === 'admin' && role !== 'admin') {
      const adminCount = db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'admin'))
        .get()?.count ?? 0;
      if (adminCount <= 1) {
        throw invalid('Cannot demote the last admin');
      }
    }

    db.update(users).set({ role }).where(eq(users.id, id)).run();
    return reply.code(204).send();
  });

  app.patch('/api/admin/users/:id/banned', {
    schema: {
      tags: ['admin'],
      summary: 'Ban or unban user',
      description: 'Ban or unban a user account.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      },
      body: {
        type: 'object',
        required: ['banned'],
        properties: {
          banned: { type: 'boolean' },
        },
      },
      response: {
        204: { type: 'null', description: 'Ban status updated' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { banned } = parse(z.object({ banned: z.boolean() }), request.body);

    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) throw invalid('User not found');

    if (banned && existing.role === 'admin') {
      const adminCount = db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'admin'))
        .get()?.count ?? 0;
      if (adminCount <= 1) {
        throw invalid('Cannot disable the last admin');
      }
    }

    db.update(users).set({ banned }).where(eq(users.id, id)).run();
    if (banned) {
      db.delete(sessions).where(eq(sessions.userId, id)).run();
    }
    return reply.code(204).send();
  });

  app.patch('/api/admin/users/:id/limits', {
    schema: {
      tags: ['admin'],
      summary: 'Override user limits',
      description: 'Set per-user resource limit overrides.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      },
      body: {
        type: 'object',
        required: ['overrides'],
        properties: {
          overrides: {
            type: 'object',
            properties: {
              storageBytes: { type: 'integer', minimum: 0, nullable: true },
              audioFileBytes: { type: 'integer', minimum: 0, nullable: true },
              audioDurationSec: { type: 'integer', minimum: 0, nullable: true },
              imageFileBytes: { type: 'integer', minimum: 0, nullable: true },
              mixItems: { type: 'integer', minimum: 0, nullable: true },
            },
          },
        },
      },
      response: {
        204: { type: 'null', description: 'Limits updated' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const { overrides } = parse(
      z.object({
        overrides: z.object({
          storageBytes: z.number().int().min(0).nullable().optional(),
          audioFileBytes: z.number().int().min(0).nullable().optional(),
          audioDurationSec: z.number().int().min(0).nullable().optional(),
          imageFileBytes: z.number().int().min(0).nullable().optional(),
          mixItems: z.number().int().min(0).nullable().optional(),
        }),
      }),
      request.body,
    );

    const updateData: Partial<UserRow> = {};
    for (const key of Object.keys(overrides) as (keyof typeof overrides)[]) {
      const value = overrides[key];
      if (value !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateData[overrideColumn(key)] = value as any;
      }
    }

    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) throw invalid('User not found');

    db.update(users).set(updateData).where(eq(users.id, id)).run();
    return reply.code(204).send();
  });

  app.delete('/api/admin/users/:id', {
    schema: {
      tags: ['admin'],
      summary: 'Delete user',
      description: 'Permanently deletes a user and all their data.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      },
      response: {
        204: { type: 'null', description: 'User deleted' },
      },
    },
  }, async (request, reply) => {
    await requireAdmin(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);

    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) throw invalid('User not found');

    if (existing.role === 'admin') {
      const adminCount = db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(eq(users.role, 'admin'))
        .get()?.count ?? 0;
      if (adminCount <= 1) {
        throw invalid('Cannot delete the last admin');
      }
    }

    await removeUserFiles(id);
    db.delete(users).where(eq(users.id, id)).run();
    return reply.code(204).send();
  });

  // One-time password reset: a link the admin hands to the user.
  // The token is stored in Better Auth's verification format, so the standard
  // POST /api/auth/reset-password completes the flow (the reset page is task C2).
  app.post('/api/admin/users/:id/reset-password', {
    schema: {
      tags: ['admin'],
      summary: 'Reset user password',
      description: 'Generates a one-time password reset link for a user.',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Password reset URL' },
          },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request);
    const { id } = parse(z.object({ id: z.string() }), request.params);
    const existing = db.select().from(users).where(eq(users.id, id)).get();
    if (!existing) throw invalid('User not found');

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TTL_SEC * 1000);
    db.insert(verifications)
      .values({
        id: randomUUID(),
        identifier: `reset-password:${token}`,
        value: id,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    return { url: `${config.publicUrl}/reset-password?token=${token}` };
  });

  // Disk usage for the admin charts: current split plus one row per day. The snapshot of
  // today is refreshed on every read, so the chart fills itself as the admin looks at it.
  app.get('/api/admin/usage', {
    schema: {
      tags: ['admin'],
      summary: 'Disk usage',
      description: 'Returns current disk usage breakdown and daily history for the admin dashboard charts.',
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            current: {
              type: 'object',
              properties: {
                audioBytes: { type: 'integer' },
                imageBytes: { type: 'integer' },
                databaseBytes: { type: 'integer' },
                freeBytes: { type: 'integer' },
              },
            },
            history: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  day: { type: 'string' },
                  audioBytes: { type: 'integer' },
                  imageBytes: { type: 'integer' },
                  databaseBytes: { type: 'integer' },
                  freeBytes: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request) => {
    await requireAdmin(request);
    const current = await measureDisk();
    const day = new Date().toISOString().slice(0, 10);
    db.insert(storageSnapshots)
      .values({ day, ...current })
      .onConflictDoUpdate({ target: storageSnapshots.day, set: current })
      .run();
    const history = db.select().from(storageSnapshots).orderBy(storageSnapshots.day).all();
    return { current, history };
  });
}

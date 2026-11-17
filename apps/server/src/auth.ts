import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { admin } from 'better-auth/plugins';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db } from './db/index.js';
import { accounts, sessions, users, verifications } from './db/schema.js';
import { forbidden, notFound, unauthorized } from './errors.js';
import { signupsOpen } from './settings.js';

export type UserRow = typeof users.$inferSelect;

const DAY = 60 * 60 * 24;
/** How often `lastActiveAt` is refreshed for an active user. */
const ACTIVITY_GRANULARITY_MS = 5 * 60 * 1000;

export const auth = betterAuth({
  basePath: '/api/auth',
  baseURL: config.publicUrl,
  secret: config.authSecret,
  trustedOrigins: [config.publicUrl, ...config.trustedOrigins],
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  // No email is sent by this server: no verification, no self-service reset.
  emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128 },
  session: { expiresIn: 30 * DAY, updateAge: DAY },
  rateLimit: {
    enabled: config.rateLimit,
    window: 60,
    max: 120,
    customRules: {
      '/sign-up/email': { window: 60 * 60, max: 5 },
      '/sign-in/email': { window: 10 * 60, max: 10 },
    },
  },
  advanced: config.trustProxy
    ? { ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] } }
    : {},
  // Roles and disabling ("banned") come from the admin plugin. Its HTTP routes are not
  // exposed (see authRoutes): admin actions go through /api/admin, which also handles files.
  plugins: [admin()],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' && !signupsOpen()) {
        throw new APIError('FORBIDDEN', { code: 'signups_closed', message: 'Sign-ups are closed' });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: { ...user, role: isAdminEmail(user.email) ? 'admin' : 'user' },
        }),
      },
    },
  },
});

function isAdminEmail(email: string): boolean {
  return config.adminEmail !== undefined && email.toLowerCase() === config.adminEmail;
}

/** Gives the admin role to the ADMIN_EMAIL account if it already exists (run at start). */
export function promoteConfiguredAdmin() {
  if (!config.adminEmail) return;
  db.update(users)
    .set({ role: 'admin' })
    .where(eq(sql`lower(${users.email})`, config.adminEmail))
    .run();
}

/** The signed-in, enabled user behind a request. Throws 401 otherwise. */
export async function requireUser(request: FastifyRequest): Promise<UserRow> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session) throw unauthorized();
  const user = db.select().from(users).where(eq(users.id, session.user.id)).get();
  if (!user || user.banned) throw unauthorized();

  const now = Date.now();
  if (!user.lastActiveAt || now - user.lastActiveAt.getTime() > ACTIVITY_GRANULARITY_MS) {
    db.update(users).set({ lastActiveAt: new Date(now) }).where(eq(users.id, user.id)).run();
  }
  return user;
}

export async function requireAdmin(request: FastifyRequest): Promise<UserRow> {
  const user = await requireUser(request);
  if (user.role !== 'admin') throw forbidden('Admin only');
  return user;
}

/** Mounts Better Auth's fetch handler at /api/auth/* (Fastify to Fetch API bridge). */
export function authRoutes(app: FastifyInstance) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      if (request.url.startsWith('/api/auth/admin')) throw notFound('Route');

      const url = new URL(request.url, config.publicUrl);
      const headers = fromNodeHeaders(request.headers);
      // The body is re-serialized below: drop length/encoding headers of the original request.
      headers.delete('content-length');
      headers.delete('transfer-encoding');
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          body:
            request.method === 'GET' || request.body === undefined
              ? undefined
              : JSON.stringify(request.body),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}

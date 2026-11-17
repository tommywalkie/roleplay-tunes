// This file must NOT set ADMIN_EMAIL: it exercises the default admin address, and config
// is read once at import time (an env var here would override the default under test).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config.js';
import { call, signUp } from './test/helpers.js';

let app: FastifyInstance;
let dbModule: typeof import('./db/index.js');
let schema: typeof import('./db/schema.js');

beforeAll(async () => {
  dbModule = await import('./db/index.js');
  schema = await import('./db/schema.js');
  await dbModule.ensureSchema();

  // An account that already exists when the server starts is promoted at start.
  const now = new Date();
  dbModule.db
    .insert(schema.users)
    .values({
      id: 'pre-existing',
      name: 'Pre',
      email: 'ADMIN@ROLEPLAY-TUNES.LOCAL',
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const { buildApp } = await import('./app.js');
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

const roleOf = (id: string) =>
  dbModule.db.select().from(schema.users).where(eq(schema.users.id, id)).get()?.role;

describe('ADMIN_EMAIL default', () => {
  it('defaults to the unrouteable admin@roleplay-tunes.local', () => {
    expect(loadConfig({}).adminEmail).toBe('admin@roleplay-tunes.local');
  });

  it('an explicitly set ADMIN_EMAIL wins over the default and is lowercased', () => {
    expect(loadConfig({ ADMIN_EMAIL: 'Admin@Example.com' }).adminEmail).toBe('admin@example.com');
  });

  it('promotes an existing account with the default email when the server starts', () => {
    expect(roleOf('pre-existing')).toBe('admin');
  });

  it('gives the admin role to the account that signs up with the default email', async () => {
    dbModule.db.delete(schema.users).where(eq(schema.users.id, 'pre-existing')).run();
    const admin = await signUp(app, 'admin@roleplay-tunes.local');
    expect((await call(app, admin, 'GET', '/api/me')).json().role).toBe('admin');
  });

  it('gives every other account the user role', async () => {
    const other = await signUp(app, 'someone-else@example.com');
    expect((await call(app, other, 'GET', '/api/me')).json().role).toBe('user');
    const lookalike = await signUp(app, 'admin@roleplay-tunes.local.evil.test');
    expect((await call(app, lookalike, 'GET', '/api/me')).json().role).toBe('user');
  });

  it('does not let a client choose its own role at sign-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        email: 'sneaky@example.com',
        password: 'password123',
        name: 'Sneaky',
        role: 'admin',
      },
    });
    const id = res.json().user?.id as string | undefined;
    if (id) expect(roleOf(id)).toBe('user');
    else expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});

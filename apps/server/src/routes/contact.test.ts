/**
 * The contact form and its admin routes.
 *
 * `config.ts` reads the environment once at import time and the mode it holds decides
 * whether `POST /api/contact` exists, so the mode is chosen with `vi.stubEnv` before a
 * fresh module graph is imported. Each suite resets the modules, so it gets its own config
 * and its own in-memory database and the suites cannot see each other's rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContactMessage } from '@dnd/shared';
import { loadConfig } from '../config.js';
import { call, expectError, signUp, type TestUser } from '../test/helpers.js';

/** The default `ADMIN_EMAIL`; signing up with it is how the tests fake an admin. */
const ADMIN_EMAIL = 'admin@roleplay-tunes.local';

/** A valid submission, with the bot trap left empty. */
const submission = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  message: 'The tavern sounds are lovely.',
  _honeypot: '',
};

describe('POST /api/contact with the contact form off', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('answers 404 when no contact mode is configured', async () => {
    const res = await call(app, null, 'POST', '/api/contact', submission);
    expectError(res, 404, 'not_found');
  });
});

describe('POST /api/contact in local mode', () => {
  let app: FastifyInstance;
  let dbModule: typeof import('../db/index.js');
  let schema: typeof import('../db/schema.js');

  beforeAll(async () => {
    vi.stubEnv('CONTACT_FORM_MODE', 'local');
    vi.resetModules();
    dbModule = await import('../db/index.js');
    schema = await import('../db/schema.js');
    const { buildApp } = await import('../app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const stored = () => dbModule.db.select().from(schema.contactMessages).all();

  it('stores a valid message and answers 204', async () => {
    const res = await call(app, null, 'POST', '/api/contact', submission);
    expect(res.statusCode, res.body).toBe(204);
    expect(stored()).toEqual([
      expect.objectContaining({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        message: 'The tavern sounds are lovely.',
        readAt: null,
      }),
    ]);
  });

  it('announces local mode to the app', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/contact.js' });
    expect(res.body).toBe(
      'window.__CONTACT_FORM__ = {"mode":"local","provider":"dsforms","endpoint":null};\n',
    );
  });

  it('accepts a filled honeypot but stores nothing', async () => {
    const res = await call(app, null, 'POST', '/api/contact', {
      name: 'Spam Bot',
      email: 'bot@example.com',
      message: 'Buy something',
      _honeypot: 'http://spam.example',
    });
    expect(res.statusCode, res.body).toBe(204);
    expect(stored().some((m) => m.name === 'Spam Bot')).toBe(false);
  });

  it('rejects an invalid body with a validation error and stores nothing', async () => {
    const res = await call(app, null, 'POST', '/api/contact', {
      name: 'Ada Lovelace',
      email: 'not-an-email',
      message: 'Hello',
      _honeypot: '',
    });
    expectError(res, 400, 'validation');
    expect(stored().some((m) => m.email === 'not-an-email')).toBe(false);
  });
});

describe('admin contact message routes', () => {
  let app: FastifyInstance;
  let dbModule: typeof import('../db/index.js');
  let schema: typeof import('../db/schema.js');
  let admin: TestUser;
  let user: TestUser;

  beforeAll(async () => {
    vi.resetModules();
    dbModule = await import('../db/index.js');
    schema = await import('../db/schema.js');
    const { buildApp } = await import('../app.js');
    app = await buildApp();
    await app.ready();
    admin = await signUp(app, ADMIN_EMAIL);
    user = await signUp(app);
    // Distinct timestamps, so "newest first" is unambiguous.
    dbModule.db
      .insert(schema.contactMessages)
      .values([
        { id: 'm-old', name: 'Older', email: 'old@example.com', message: 'Old', createdAt: new Date('2026-11-01T10:00:00Z'), readAt: null },
        { id: 'm-new', name: 'Newer', email: 'new@example.com', message: 'New', createdAt: new Date('2026-11-02T10:00:00Z'), readAt: null },
      ])
      .run();
  });
  afterAll(async () => {
    await app.close();
  });

  const list = async () =>
    (await call(app, admin, 'GET', '/api/admin/contact')).json() as ContactMessage[];

  it('refuses a non-admin caller', async () => {
    expectError(await call(app, user, 'GET', '/api/admin/contact'), 403, 'forbidden');
    expectError(
      await call(app, user, 'PATCH', '/api/admin/contact/m-old/read', { read: true }),
      403,
      'forbidden',
    );
    expectError(await call(app, user, 'DELETE', '/api/admin/contact/m-old'), 403, 'forbidden');
  });

  it('lists every message, newest first', async () => {
    const res = await call(app, admin, 'GET', '/api/admin/contact');
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ContactMessage[]).map((m) => m.id)).toEqual(['m-new', 'm-old']);
  });

  it('marks a message read and back to unread', async () => {
    const marked = await call(app, admin, 'PATCH', '/api/admin/contact/m-old/read', { read: true });
    expect(marked.statusCode, marked.body).toBe(204);
    expect((await list()).find((m) => m.id === 'm-old')?.readAt).not.toBeNull();

    const unmarked = await call(app, admin, 'PATCH', '/api/admin/contact/m-old/read', {
      read: false,
    });
    expect(unmarked.statusCode, unmarked.body).toBe(204);
    expect((await list()).find((m) => m.id === 'm-old')?.readAt).toBeNull();
  });

  it('deletes a message', async () => {
    const res = await call(app, admin, 'DELETE', '/api/admin/contact/m-new');
    expect(res.statusCode, res.body).toBe(204);
    expect((await list()).map((m) => m.id)).not.toContain('m-new');
  });
});

describe('contact form configuration', () => {
  const provider = {
    NODE_ENV: 'test',
    CONTACT_FORM_MODE: 'provider',
    CONTACT_FORM_ENDPOINT: 'https://forms.example/submit',
  } as const;

  it('is off unless the mode is local or provider', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).contactFormMode).toBe('off');
    expect(loadConfig({ NODE_ENV: 'test', CONTACT_FORM_MODE: '' }).contactFormMode).toBe('off');
  });

  it('refuses provider mode without a provider or an endpoint', () => {
    expect(() => loadConfig({ ...provider })).toThrow(/CONTACT_FORM_PROVIDER/);
    expect(() => loadConfig({ ...provider, CONTACT_FORM_PROVIDER: 'dsforms', CONTACT_FORM_ENDPOINT: '' })).toThrow(
      /CONTACT_FORM_ENDPOINT/,
    );
  });

  it('keeps the endpoint origin in provider mode and nothing otherwise', () => {
    const configured = loadConfig({ ...provider, CONTACT_FORM_PROVIDER: 'dsforms' });
    expect(configured.contactFormMode).toBe('provider');
    expect(configured.contactFormEndpoint).toBe('https://forms.example/submit');
    expect(configured.contactFormOrigin).toBe('https://forms.example');
    expect(loadConfig({ NODE_ENV: 'test', CONTACT_FORM_MODE: 'local' }).contactFormOrigin).toBeNull();
  });
});

describe('GET /api/settings/contact.js', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('hands the app the settings it cannot read from the server environment', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/contact.js' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(
      'window.__CONTACT_FORM__ = {"mode":"off","provider":"dsforms","endpoint":null};\n',
    );
  });
});

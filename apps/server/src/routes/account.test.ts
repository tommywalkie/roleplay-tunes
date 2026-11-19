import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { accounts, mixes, scenes, sessions, sounds, users } from '../db/schema.js';
import { setSignupsOpen, writeSetting } from '../settings.js';
import {
  call,
  cookieHeader,
  createMix,
  createScene,
  expectError,
  signUp,
  uploadSound,
} from '../test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterEach(() => {
  setSignupsOpen(true);
});
afterAll(async () => {
  await app.close();
});

const signIn = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password } });
const signUpRaw = (email: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password, name: 'Someone' },
  });

describe('GET /api/me', () => {
  it('returns the account, effective limits and usage, and nothing sensitive', async () => {
    const user = await signUp(app);
    const res = await call(app, user, 'GET', '/api/me');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      'changelogUnseen',
      'email',
      'id',
      'limits',
      'name',
      'role',
      'termsAcceptedAt',
      'usage',
    ]);
    expect(body).toMatchObject({ id: user.id, email: user.email, name: 'Test User', role: 'user' });
    expect(Object.keys(body.limits).sort()).toEqual([
      'audioDurationSec',
      'audioFileBytes',
      'imageFileBytes',
      'mixItems',
      'storageBytes',
    ]);
    expect(res.body).not.toMatch(/password|token|banned/i);
  });

  it('updates lastActiveAt when the user acts', async () => {
    const user = await signUp(app);
    await call(app, user, 'GET', '/api/me');
    const row = db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.lastActiveAt).toBeInstanceOf(Date);
  });

  /**
   * The rules dialog closes on `me.termsAcceptedAt` matching the version on record, so a
   * response schema that forgets the field leaves the dialog up forever.
   */
  it('carries the acceptance back on /api/me, so the rules dialog can close', async () => {
    const user = await signUp(app);
    expect((await call(app, user, 'GET', '/api/me')).json().termsAcceptedAt).toBeNull();

    writeSetting('termsEnabled', 'true');
    writeSetting('termsRules.en', '<p>Keep the noise down</p>');
    writeSetting('termsUpdatedAt', new Date().toISOString());

    const before = (await call(app, user, 'GET', '/api/terms/en')).json().updatedAt;
    expect((await call(app, user, 'POST', '/api/terms/accept')).statusCode).toBe(204);

    const after = (await call(app, user, 'GET', '/api/me')).json().termsAcceptedAt;
    expect(after).not.toBeNull();
    // The same instant, to the millisecond: the client compares the two strings.
    expect(new Date(after).getTime()).toBe(new Date(before).getTime());

    // Leave no rules switched on for the rest of the file.
    writeSetting('termsEnabled', 'false');
  });
});

describe('PATCH /api/me', () => {
  it('renames the account, trimmed, and returns it', async () => {
    const user = await signUp(app);
    const res = await call(app, user, 'PATCH', '/api/me', { name: '  Bard of the Inn  ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: user.id, name: 'Bard of the Inn' });
    expect((await call(app, user, 'GET', '/api/me')).json().name).toBe('Bard of the Inn');
  });

  it('shows the new name on what the user shared', async () => {
    const owner = await signUp(app);
    const sound = await uploadSound(app, owner);
    await call(app, owner, 'PATCH', `/api/sounds/${sound.id}`, { isPublic: true });
    await call(app, owner, 'PATCH', '/api/me', { name: 'Nightjar' });
    const other = await signUp(app);
    const library = (await call(app, other, 'GET', '/api/library')).json();
    const shared = library.sounds.find((s: { id: string }) => s.id === sound.id);
    expect(shared.ownerName).toBe('Nightjar');
  });

  it('refuses a blank, too long or control-character name, and anything else', async () => {
    const user = await signUp(app);
    expectError(await call(app, user, 'PATCH', '/api/me', { name: '   ' }), 400, 'validation');
    expectError(await call(app, user, 'PATCH', '/api/me', { name: 'x'.repeat(101) }), 400, 'validation');
    expectError(await call(app, user, 'PATCH', '/api/me', { name: 'a\u0007b' }), 400, 'validation');
    expectError(
      await call(app, user, 'PATCH', '/api/me', { name: 'Fine', email: 'new@example.com' }),
      400,
      'validation',
    );
    expect((await call(app, user, 'GET', '/api/me')).json().name).toBe('Test User');
  });
});

describe('sign-up and sign-in', () => {
  it('refuses a password shorter than 8 characters', async () => {
    const email = `short-${Date.now()}@example.com`;
    const res = await signUpRaw(email, '1234567');
    expect(res.statusCode).toBe(400);
    expect((await signIn(email, '1234567')).statusCode).toBeGreaterThanOrEqual(400);
    expect(db.select().from(users).where(eq(users.email, email)).get()).toBeUndefined();
  });

  it('accepts a password of exactly 8 characters', async () => {
    const res = await signUpRaw(`eight-${Date.now()}@example.com`, '12345678');
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses a second account with the same email', async () => {
    const user = await signUp(app);
    const res = await signUpRaw(user.email, 'another-password');
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('signs in with the right password and refuses the wrong one', async () => {
    const user = await signUp(app, undefined, 'correct-horse');
    const wrong = await signIn(user.email, 'wrong-password');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    const unknown = await signIn('nobody@example.com', 'correct-horse');
    expect(unknown.statusCode).toBe(401);

    const ok = await signIn(user.email, 'correct-horse');
    expect(ok.statusCode, ok.body).toBe(200);
    const cookie = cookieHeader(ok.headers['set-cookie']);
    expect(cookie).not.toBe('');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });

  it('marks the session cookie HttpOnly', async () => {
    const res = await signUpRaw(`cookie-${Date.now()}@example.com`, 'password123');
    const cookies = [res.headers['set-cookie']].flat().join('\n');
    expect(cookies).toMatch(/HttpOnly/i);
  });

  it('ends the session on sign-out', async () => {
    const user = await signUp(app);
    const res = await call(app, user, 'POST', '/api/auth/sign-out', {});
    expect(res.statusCode, res.body).toBe(200);
    expectError(await call(app, user, 'GET', '/api/me'), 401, 'unauthorized');
  });
});

describe('closed sign-ups', () => {
  it('refuses sign-up with 403 and reflects the state in public settings', async () => {
    setSignupsOpen(false);
    const email = `closed-${Date.now()}@example.com`;
    const res = await signUpRaw(email, 'password123');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('signups_closed');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(db.select().from(users).where(eq(users.email, email)).get()).toBeUndefined();

    const settings = await call(app, null, 'GET', '/api/settings/public');
    expect(settings.json()).toEqual({ signupsOpen: false });
  });

  it('lets existing users sign in while sign-ups are closed', async () => {
    const user = await signUp(app, undefined, 'password123');
    setSignupsOpen(false);
    expect((await signIn(user.email, 'password123')).statusCode).toBe(200);
    expect((await call(app, user, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('accepts sign-ups again once reopened', async () => {
    setSignupsOpen(false);
    setSignupsOpen(true);
    expect((await call(app, null, 'GET', '/api/settings/public')).json()).toEqual({
      signupsOpen: true,
    });
    await signUp(app);
  });
});

describe('disabled accounts', () => {
  it('answers 401 on the API for a banned user and recovers when unbanned', async () => {
    const user = await signUp(app, undefined, 'password123');
    db.update(users).set({ banned: true }).where(eq(users.id, user.id)).run();
    for (const url of ['/api/me', '/api/sounds', '/api/mixes', '/api/scenes']) {
      expectError(await call(app, user, 'GET', url), 401, 'unauthorized');
    }
    db.update(users).set({ banned: false }).where(eq(users.id, user.id)).run();
    expect((await call(app, user, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('refuses a new sign-in for a banned user', async () => {
    const user = await signUp(app, undefined, 'password123');
    db.update(users).set({ banned: true }).where(eq(users.id, user.id)).run();
    const res = await signIn(user.email, 'password123');
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('keeps a banned user from reading their audio', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    db.update(users).set({ banned: true }).where(eq(users.id, user.id)).run();
    expectError(await call(app, user, 'GET', sound.audioUrl), 401, 'unauthorized');
  });
});

describe('DELETE /api/me', () => {
  it('refuses a wrong email and deletes nothing', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const res = await call(app, user, 'DELETE', '/api/me', { email: 'someone-else@example.com' });
    expectError(res, 400, 'validation');
    expect(res.json().error.fields).toHaveProperty('email');
    expect((await call(app, user, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call(app, user, 'GET', `/api/sounds/${sound.id}`)).statusCode).toBe(200);
  });

  it('refuses a missing, empty or extra-field body', async () => {
    const user = await signUp(app);
    expectError(await call(app, user, 'DELETE', '/api/me'), 400, 'validation');
    expectError(await call(app, user, 'DELETE', '/api/me', {}), 400, 'validation');
    expectError(await call(app, user, 'DELETE', '/api/me', { email: '' }), 400, 'validation');
    expectError(
      await call(app, user, 'DELETE', '/api/me', { email: user.email, force: true }),
      400,
      'validation',
    );
    expect((await call(app, user, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('does not accept the email of another account', async () => {
    const user = await signUp(app);
    const other = await signUp(app);
    const res = await call(app, user, 'DELETE', '/api/me', { email: other.email });
    expectError(res, 400, 'validation');
    expect((await call(app, other, 'GET', '/api/me')).statusCode).toBe(200);
  });

  it('removes every row and folder of the user and invalidates the session', async () => {
    const user = await signUp(app, undefined, 'password123');
    const sound = await uploadSound(app, user);
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: sound.id }] });
    await createScene(app, user, { name: 'S', soundIds: [sound.id], mixIds: [mix.id] });
    const imageDir = join(config.imageDir, user.id);
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(join(imageDir, 'stray.webp'), 'x');
    const audioDir = join(config.audioDir, user.id);
    expect(existsSync(audioDir)).toBe(true);

    const bystander = await signUp(app);
    const bystanderSound = await uploadSound(app, bystander);

    const res = await call(app, user, 'DELETE', '/api/me', { email: user.email });
    expect(res.statusCode, res.body).toBe(204);

    expect(db.select().from(users).where(eq(users.id, user.id)).all()).toEqual([]);
    expect(db.select().from(sounds).where(eq(sounds.ownerId, user.id)).all()).toEqual([]);
    expect(db.select().from(mixes).where(eq(mixes.ownerId, user.id)).all()).toEqual([]);
    expect(db.select().from(scenes).where(eq(scenes.ownerId, user.id)).all()).toEqual([]);
    expect(db.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toEqual([]);
    expect(db.select().from(accounts).where(eq(accounts.userId, user.id)).all()).toEqual([]);
    expect(existsSync(audioDir)).toBe(false);
    expect(existsSync(imageDir)).toBe(false);

    expectError(await call(app, user, 'GET', '/api/me'), 401, 'unauthorized');
    expectError(await call(app, user, 'GET', sound.audioUrl), 401, 'unauthorized');
    expect((await signIn(user.email, 'password123')).statusCode).toBe(401);

    // Other accounts are untouched.
    expect((await call(app, bystander, 'GET', `/api/sounds/${bystanderSound.id}`)).statusCode).toBe(
      200,
    );
    expect((await call(app, bystander, 'GET', bystanderSound.audioUrl)).statusCode).toBe(200);
  });

  it('matches the email without regard to case or surrounding spaces', async () => {
    const user = await signUp(app);
    const res = await call(app, user, 'DELETE', '/api/me', {
      email: `  ${user.email.toUpperCase()} `,
    });
    expect(res.statusCode, res.body).toBe(204);
  });

  it('lets the same email register again afterwards with an empty account', async () => {
    const user = await signUp(app);
    await uploadSound(app, user);
    await call(app, user, 'DELETE', '/api/me', { email: user.email });
    const again = await signUp(app, user.email);
    const me = (await call(app, again, 'GET', '/api/me')).json();
    expect(me.usage).toEqual({ storageBytes: 0, sounds: 0, mixes: 0, scenes: 0 });
    expect(me.id).not.toBe(user.id);
  });
});

import { readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_LIMITS, type Limits, type Mix } from '@dnd/shared';
import { buildApp } from '../app.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { defaultLimits, setDefaultLimits } from '../settings.js';
import {
  call,
  createMix,
  expectError,
  signUp,
  uploadRaw,
  uploadSound,
  wavFile,
  type TestUser,
} from '../test/helpers.js';

let app: FastifyInstance;
let savedDefaults: Limits;
beforeAll(async () => {
  app = await buildApp();
  savedDefaults = defaultLimits();
});
afterEach(() => {
  setDefaultLimits(savedDefaults);
});
afterAll(async () => {
  setDefaultLimits(savedDefaults);
  await app.close();
});

type Overrides = Partial<
  Pick<
    typeof users.$inferInsert,
    'limitStorageBytes' | 'limitAudioFileBytes' | 'limitAudioDurationSec' | 'limitMixItems'
  >
>;

function setOverrides(user: TestUser, overrides: Overrides) {
  db.update(users).set(overrides).where(eq(users.id, user.id)).run();
}

const me = async (user: TestUser) => (await call(app, user, 'GET', '/api/me')).json();
const tmpFiles = () => readdirSync(config.tmpDir);

describe('audio file size', () => {
  it('rejects a file over the limit with 413 and cleans up', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setOverrides(user, { limitAudioFileBytes: content.length - 1 });
    expectError(await uploadRaw(app, user, { content }), 413, 'file_too_large');
    expect(tmpFiles()).toEqual([]);
    expect((await me(user)).usage).toMatchObject({ sounds: 0, storageBytes: 0 });
  });

  it('accepts a file exactly at the limit', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setOverrides(user, { limitAudioFileBytes: content.length });
    const sound = await uploadSound(app, user, { content });
    expect(sound.sizeBytes).toBe(content.length);
  });

  it('applies the server default to users without an override', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setDefaultLimits({ audioFileBytes: content.length - 1 });
    expectError(await uploadRaw(app, user, { content }), 413, 'file_too_large');
    setDefaultLimits({ audioFileBytes: content.length });
    expect((await uploadRaw(app, user, { content })).statusCode).toBe(201);
  });

  it('does not store a rejected oversized file', async () => {
    const user = await signUp(app);
    setOverrides(user, { limitAudioFileBytes: 1000 });
    await uploadRaw(app, user, { content: wavFile(5) });
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toEqual([]);
  });
});

describe('audio duration', () => {
  it('rejects a longer sound with 400 duration_too_long', async () => {
    const user = await signUp(app);
    setOverrides(user, { limitAudioDurationSec: 5 });
    expectError(
      await uploadRaw(app, user, { content: wavFile(6) }),
      400,
      'duration_too_long',
    );
    expect(tmpFiles()).toEqual([]);
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toEqual([]);
  });

  it('accepts a sound at or under the limit', async () => {
    const user = await signUp(app);
    setOverrides(user, { limitAudioDurationSec: 5 });
    expect((await uploadRaw(app, user, { content: wavFile(5) })).statusCode).toBe(201);
    expect((await uploadRaw(app, user, { content: wavFile(2) })).statusCode).toBe(201);
  });

  it('is measured on the file even when the client claims otherwise', async () => {
    const user = await signUp(app);
    setOverrides(user, { limitAudioDurationSec: 3 });
    const res = await uploadRaw(app, user, {
      content: wavFile(4),
      fields: { durationSec: '1' },
    });
    expectError(res, 400, 'duration_too_long');
  });

  it('applies the server default to users without an override', async () => {
    const user = await signUp(app);
    setDefaultLimits({ audioDurationSec: 2 });
    expectError(await uploadRaw(app, user, { content: wavFile(3) }), 400, 'duration_too_long');
  });
});

describe('storage quota', () => {
  it('counts existing sounds and blocks the upload that would exceed it', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setOverrides(user, { limitStorageBytes: content.length * 2 + 10 });
    await uploadSound(app, user, { content });
    await uploadSound(app, user, { content });
    expect((await me(user)).usage.storageBytes).toBe(content.length * 2);

    expectError(await uploadRaw(app, user, { content }), 400, 'quota_exceeded');
    expect(tmpFiles()).toEqual([]);
    expect((await me(user)).usage.sounds).toBe(2);
  });

  it('accepts an upload that fills the quota exactly', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setOverrides(user, { limitStorageBytes: content.length * 2 });
    await uploadSound(app, user, { content });
    await uploadSound(app, user, { content });
    expectError(await uploadRaw(app, user, { content: wavFile(0.1) }), 400, 'quota_exceeded');
  });

  it('frees space when a sound is deleted', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    setOverrides(user, { limitStorageBytes: content.length + 10 });
    const first = await uploadSound(app, user, { content });
    expectError(await uploadRaw(app, user, { content }), 400, 'quota_exceeded');
    await call(app, user, 'DELETE', `/api/sounds/${first.id}`);
    expect((await uploadRaw(app, user, { content })).statusCode).toBe(201);
  });

  it('keeps the files of a user whose limit drops below usage, and blocks uploads', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    setOverrides(user, { limitStorageBytes: 1 });
    expectError(await uploadRaw(app, user), 400, 'quota_exceeded');
    const list = (await call(app, user, 'GET', '/api/sounds')).json();
    expect(list.map((s: { id: string }) => s.id)).toEqual([sound.id]);
    expect((await call(app, user, 'GET', sound.audioUrl)).statusCode).toBe(200);
    // Reading and editing still work.
    expect((await call(app, user, 'PATCH', `/api/sounds/${sound.id}`, { name: 'Ok' })).statusCode).toBe(
      200,
    );
  });

  it('is tracked per user', async () => {
    const full = await signUp(app);
    const other = await signUp(app);
    const content = wavFile(1);
    setOverrides(full, { limitStorageBytes: content.length });
    await uploadSound(app, full, { content });
    expectError(await uploadRaw(app, full, { content }), 400, 'quota_exceeded');
    expect((await uploadRaw(app, other, { content })).statusCode).toBe(201);
  });

  it('applies the server default to users without an override', async () => {
    const user = await signUp(app);
    setDefaultLimits({ storageBytes: 100 });
    expectError(await uploadRaw(app, user), 400, 'quota_exceeded');
  });
});

describe('items per mix', () => {
  async function userWithSounds(count: number) {
    const user = await signUp(app);
    const ids: string[] = [];
    for (let i = 0; i < count; i++) ids.push((await uploadSound(app, user)).id);
    return { user, items: ids.map((soundId) => ({ soundId })) };
  }

  it('rejects a create above the limit with mix_items_limit', async () => {
    const { user, items } = await userWithSounds(3);
    setOverrides(user, { limitMixItems: 2 });
    const res = await call(app, user, 'POST', '/api/mixes', { name: 'Big', items });
    expectError(res, 400, 'mix_items_limit');
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
    expect((await call(app, user, 'POST', '/api/mixes', { name: 'Ok', items: items.slice(0, 2) })).statusCode).toBe(201);
  });

  it('rejects an update above the limit and keeps the previous items', async () => {
    const { user, items } = await userWithSounds(3);
    setOverrides(user, { limitMixItems: 2 });
    const mix = await createMix(app, user, { name: 'M', items: items.slice(0, 2) });
    const res = await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { items });
    expectError(res, 400, 'mix_items_limit');
    const after = (await call(app, user, 'GET', `/api/mixes/${mix.id}`)).json() as Mix;
    expect(after).toEqual(mix);
  });

  it('treats an override of 0 as a real limit', async () => {
    const { user, items } = await userWithSounds(1);
    setOverrides(user, { limitMixItems: 0 });
    expectError(await call(app, user, 'POST', '/api/mixes', { name: 'M', items }), 400, 'mix_items_limit');
    expect((await call(app, user, 'POST', '/api/mixes', { name: 'M' })).statusCode).toBe(201);
  });

  it('enforces the default limit of 50 items', async () => {
    const user = await signUp(app);
    const items: { soundId: string }[] = [];
    const content = wavFile(0.1);
    for (let i = 0; i < 51; i++) items.push({ soundId: (await uploadSound(app, user, { content })).id });
    expectError(await call(app, user, 'POST', '/api/mixes', { name: 'M', items }), 400, 'mix_items_limit');
    expect((await call(app, user, 'POST', '/api/mixes', { name: 'M', items: items.slice(0, 50) })).statusCode).toBe(201);
  });
});

describe('overrides and defaults', () => {
  it('lets a per-user override win over the server default, in both directions', async () => {
    const strict = await signUp(app);
    const lenient = await signUp(app);
    const plain = await signUp(app);
    const sounds: Record<string, string[]> = {};
    for (const u of [strict, lenient, plain]) {
      sounds[u.id] = [];
      for (let i = 0; i < 3; i++) sounds[u.id].push((await uploadSound(app, u)).id);
    }
    const items = (u: TestUser) => sounds[u.id].map((soundId) => ({ soundId }));

    setDefaultLimits({ mixItems: 1 });
    setOverrides(strict, { limitMixItems: 0 });
    setOverrides(lenient, { limitMixItems: 3 });

    expectError(await call(app, plain, 'POST', '/api/mixes', { name: 'M', items: items(plain) }), 400, 'mix_items_limit');
    expect((await call(app, lenient, 'POST', '/api/mixes', { name: 'M', items: items(lenient) })).statusCode).toBe(201);
    expectError(await call(app, strict, 'POST', '/api/mixes', { name: 'M', items: items(strict).slice(0, 1) }), 400, 'mix_items_limit');

    // Raising the default is picked up by users without an override only.
    setDefaultLimits({ mixItems: 3 });
    expect((await call(app, plain, 'POST', '/api/mixes', { name: 'M', items: items(plain) })).statusCode).toBe(201);
    expectError(await call(app, strict, 'POST', '/api/mixes', { name: 'M', items: items(strict).slice(0, 1) }), 400, 'mix_items_limit');
  });
});

describe('GET /api/me limits and usage', () => {
  it('reports the built-in defaults for a new account', async () => {
    const user = await signUp(app);
    const body = await me(user);
    expect(body.limits).toEqual(DEFAULT_LIMITS);
    expect(body.usage).toEqual({ storageBytes: 0, sounds: 0, mixes: 0, scenes: 0 });
  });

  it('reports effective limits: overrides first, then the server defaults', async () => {
    const user = await signUp(app);
    setDefaultLimits({ audioDurationSec: 123, mixItems: 7 });
    setOverrides(user, { limitMixItems: 9, limitStorageBytes: 4242 });
    expect((await me(user)).limits).toEqual({
      ...DEFAULT_LIMITS,
      audioDurationSec: 123,
      mixItems: 9,
      storageBytes: 4242,
    });
    const plain = await signUp(app);
    expect((await me(plain)).limits).toEqual({
      ...DEFAULT_LIMITS,
      audioDurationSec: 123,
      mixItems: 7,
    });
  });

  it('reports usage counts and stored bytes', async () => {
    const user = await signUp(app);
    const a = await uploadSound(app, user, { content: wavFile(1) });
    const b = await uploadSound(app, user, { content: wavFile(2) });
    await createMix(app, user, { name: 'M', items: [{ soundId: a.id }] });
    await call(app, user, 'POST', '/api/scenes', { name: 'S' });
    expect((await me(user)).usage).toEqual({
      storageBytes: a.sizeBytes + b.sizeBytes,
      sounds: 2,
      mixes: 1,
      scenes: 1,
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Mix } from '@dnd/shared';
import { buildApp } from '../app.js';
import {
  call,
  createMix,
  createScene,
  expectError,
  signUp,
  uploadSound,
  wavFile,
  type TestUser,
} from '../test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

async function fixture(soundCount = 3) {
  const user = await signUp(app);
  const sounds = [];
  for (let i = 0; i < soundCount; i++) {
    sounds.push(await uploadSound(app, user, { fields: { name: `Sound ${i}` } }));
  }
  return { user, sounds };
}

const soundIdsOf = (mix: Mix) => mix.items.map((i) => i.soundId);
const getMix = async (user: TestUser, id: string) =>
  (await call(app, user, 'GET', `/api/mixes/${id}`)).json() as Mix;

describe('create', () => {
  it('creates an empty mix from a name alone', async () => {
    const { user } = await fixture(0);
    const mix = await createMix(app, user, { name: '  Empty  ' });
    expect(mix).toMatchObject({ name: 'Empty', items: [], sceneIds: [], illustration: { type: 'none' } });
  });

  it('keeps the order of the items', async () => {
    const { user, sounds } = await fixture();
    const [a, b, c] = sounds;
    const mix = await createMix(app, user, {
      name: 'Ordered',
      items: [{ soundId: c.id }, { soundId: a.id }, { soundId: b.id }],
    });
    expect(soundIdsOf(mix)).toEqual([c.id, a.id, b.id]);
    expect(soundIdsOf(await getMix(user, mix.id))).toEqual([c.id, a.id, b.id]);
    const list = (await call(app, user, 'GET', '/api/mixes')).json() as Mix[];
    expect(soundIdsOf(list[0])).toEqual([c.id, a.id, b.id]);
    expect(new Set(mix.items.map((i) => i.id)).size).toBe(3);
  });

  it('fills missing item settings from the sound', async () => {
    const { user, sounds } = await fixture(1);
    const [sound] = sounds;
    await call(app, user, 'PATCH', `/api/sounds/${sound.id}`, {
      defaultMode: 'recurring',
      defaultVolume: 0.5,
      intervalMinSec: 5,
      intervalMaxSec: 9,
      volumeVariation: 0.3,
    });
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: sound.id }] });
    expect(mix.items[0]).toMatchObject({
      soundId: sound.id,
      mode: 'recurring',
      volume: 0.5,
      intervalMinSec: 5,
      intervalMaxSec: 9,
      volumeVariation: 0.3,
    });
  });

  it('lets an item override the mode and settings without touching the sound', async () => {
    const { user, sounds } = await fixture(1);
    const [sound] = sounds;
    expect(sound.defaultMode).toBe('oneshot');
    const mix = await createMix(app, user, {
      name: 'M',
      items: [
        {
          soundId: sound.id,
          mode: 'recurring',
          volume: 0.2,
          intervalMinSec: 30,
          intervalMaxSec: 60,
          volumeVariation: 0.1,
        },
      ],
    });
    expect(mix.items[0]).toMatchObject({
      mode: 'recurring',
      volume: 0.2,
      intervalMinSec: 30,
      intervalMaxSec: 60,
      volumeVariation: 0.1,
    });
    const after = (await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json();
    expect(after).toMatchObject({ defaultMode: 'oneshot', defaultVolume: 0.8 });
  });

  it('rejects the same sound twice in one mix', async () => {
    const { user, sounds } = await fixture(1);
    const res = await call(app, user, 'POST', '/api/mixes', {
      name: 'Dup',
      items: [{ soundId: sounds[0].id }, { soundId: sounds[0].id, mode: 'loop' }],
    });
    expectError(res, 400, 'validation');
    expect(res.json().error.fields).toHaveProperty('items');
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });

  it('allows one sound in several mixes', async () => {
    const { user, sounds } = await fixture(1);
    await createMix(app, user, { name: 'One', items: [{ soundId: sounds[0].id }] });
    await createMix(app, user, { name: 'Two', items: [{ soundId: sounds[0].id }] });
  });

  it('rejects an unknown sound id and creates nothing', async () => {
    const { user, sounds } = await fixture(1);
    const res = await call(app, user, 'POST', '/api/mixes', {
      name: 'Ghost',
      items: [{ soundId: sounds[0].id }, { soundId: 'does-not-exist' }],
    });
    expectError(res, 400, 'validation');
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });

  it('validates the item fields', async () => {
    const { user, sounds } = await fixture(1);
    const id = sounds[0].id;
    const bad: unknown[] = [
      { soundId: id, volume: 1.5 },
      { soundId: id, volume: -1 },
      { soundId: id, mode: 'random' },
      { soundId: id, intervalMinSec: 0 },
      { soundId: id, volumeVariation: 2 },
      { soundId: id, pan: 0.5 },
      { soundId: id, muted: true },
      { soundId: id, position: 3 },
      { mode: 'loop' },
      'text',
    ];
    for (const item of bad) {
      const res = await call(app, user, 'POST', '/api/mixes', { name: 'X', items: [item] });
      expectError(res, 400, 'validation');
    }
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });

  it('rejects an item whose interval minimum is above its maximum', async () => {
    const { user, sounds } = await fixture(1);
    const both = await call(app, user, 'POST', '/api/mixes', {
      name: 'X',
      items: [{ soundId: sounds[0].id, intervalMinSec: 50, intervalMaxSec: 10 }],
    });
    expectError(both, 400, 'validation');
    // The sound's own minimum (20 s) is the counterpart of a lone maximum.
    const lone = await call(app, user, 'POST', '/api/mixes', {
      name: 'X',
      items: [{ soundId: sounds[0].id, intervalMaxSec: 10 }],
    });
    expectError(lone, 400, 'validation');
  });

  it('validates the name and rejects unknown fields', async () => {
    const { user } = await fixture(0);
    for (const body of [
      {},
      { name: '' },
      { name: '   ' },
      { name: 'n'.repeat(101) },
      { name: 5 },
      { name: 'ok', sceneId: 'x' },
      { name: 'ok', category: 'tavern' },
      { name: 'ok', ownerId: 'someone' },
    ]) {
      expectError(await call(app, user, 'POST', '/api/mixes', body), 400, 'validation');
    }
  });

  it('attaches the mix to the given scenes', async () => {
    const { user } = await fixture(0);
    const s1 = await createScene(app, user, { name: 'One' });
    const s2 = await createScene(app, user, { name: 'Two' });
    const mix = await createMix(app, user, { name: 'M', sceneIds: [s1.id, s2.id] });
    expect([...mix.sceneIds].sort()).toEqual([s1.id, s2.id].sort());
    expect((await call(app, user, 'GET', `/api/scenes/${s1.id}`)).json().mixIds).toEqual([mix.id]);
  });

  it('rejects an unknown scene id and creates nothing', async () => {
    const { user } = await fixture(0);
    expectError(
      await call(app, user, 'POST', '/api/mixes', { name: 'M', sceneIds: ['nope'] }),
      400,
      'validation',
    );
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });
});

describe('update', () => {
  it('replaces the items and keeps the new order', async () => {
    const { user, sounds } = await fixture();
    const [a, b, c] = sounds;
    const mix = await createMix(app, user, {
      name: 'M',
      items: [{ soundId: a.id }, { soundId: b.id }],
    });
    const res = await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, {
      items: [{ soundId: c.id }, { soundId: a.id, mode: 'loop', volume: 0.1 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    const updated = res.json() as Mix;
    expect(soundIdsOf(updated)).toEqual([c.id, a.id]);
    expect(updated.items[1]).toMatchObject({ mode: 'loop', volume: 0.1 });
    expect(soundIdsOf(await getMix(user, mix.id))).toEqual([c.id, a.id]);
  });

  it('reorders by sending the same sounds in another order', async () => {
    const { user, sounds } = await fixture();
    const [a, b, c] = sounds;
    const mix = await createMix(app, user, {
      name: 'M',
      items: [{ soundId: a.id }, { soundId: b.id }, { soundId: c.id }],
    });
    await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, {
      items: [{ soundId: c.id }, { soundId: b.id }, { soundId: a.id }],
    });
    expect(soundIdsOf(await getMix(user, mix.id))).toEqual([c.id, b.id, a.id]);
  });

  it('clears the items with an empty list', async () => {
    const { user, sounds } = await fixture(1);
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: sounds[0].id }] });
    await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { items: [] });
    expect((await getMix(user, mix.id)).items).toEqual([]);
  });

  it('leaves the items alone when only the name changes', async () => {
    const { user, sounds } = await fixture();
    const mix = await createMix(app, user, {
      name: 'Old',
      items: sounds.map((s) => ({ soundId: s.id, volume: 0.3 })),
    });
    const res = await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { name: '  New  ' });
    expect(res.statusCode).toBe(200);
    const after = res.json() as Mix;
    expect(after.name).toBe('New');
    expect(after.items).toEqual(mix.items);
  });

  it('leaves the scenes alone when sceneIds is absent and replaces them when present', async () => {
    const { user } = await fixture(0);
    const s1 = await createScene(app, user, { name: 'One' });
    const s2 = await createScene(app, user, { name: 'Two' });
    const mix = await createMix(app, user, { name: 'M', sceneIds: [s1.id] });

    expect((await getMix(user, mix.id)).sceneIds).toEqual([s1.id]);
    await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { name: 'Renamed' });
    expect((await getMix(user, mix.id)).sceneIds).toEqual([s1.id]);

    await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { sceneIds: [s2.id] });
    expect((await getMix(user, mix.id)).sceneIds).toEqual([s2.id]);
    expect((await call(app, user, 'GET', `/api/scenes/${s1.id}`)).json().mixIds).toEqual([]);

    await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { sceneIds: [] });
    expect((await getMix(user, mix.id)).sceneIds).toEqual([]);
  });

  it('rejects an unknown or duplicate sound and keeps the previous items', async () => {
    const { user, sounds } = await fixture(2);
    const [a, b] = sounds;
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: a.id }] });

    expectError(
      await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, {
        items: [{ soundId: b.id }, { soundId: 'ghost' }],
      }),
      400,
      'validation',
    );
    expectError(
      await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, {
        items: [{ soundId: b.id }, { soundId: b.id }],
      }),
      400,
      'validation',
    );
    expect(await getMix(user, mix.id)).toEqual(mix);
  });

  it('rejects an invalid name without applying other fields', async () => {
    const { user, sounds } = await fixture(1);
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: sounds[0].id }] });
    expectError(
      await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, { name: '', items: [] }),
      400,
      'validation',
    );
    expect(await getMix(user, mix.id)).toEqual(mix);
  });

  it('rejects unknown fields', async () => {
    const { user } = await fixture(0);
    const mix = await createMix(app, user);
    for (const body of [{ foo: 1 }, { id: 'x' }, { ownerId: 'x' }, { createdAt: 'x' }]) {
      expectError(await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, body), 400, 'validation');
    }
  });
});

describe('loop overrides', () => {
  /** Two 30 s sounds, long enough to hold a loop well inside the track. */
  async function loopFixture() {
    const user = await signUp(app);
    const sounds = [
      await uploadSound(app, user, { content: wavFile(30), fields: { name: 'Rain' } }),
      await uploadSound(app, user, { content: wavFile(30), fields: { name: 'Wind' } }),
    ];
    return { user, sounds };
  }

  it('stores an item’s loop overrides and returns nulls for an item without them', async () => {
    const { user, sounds } = await loopFixture();
    const [rain, wind] = sounds;
    const mix = await createMix(app, user, {
      name: 'Storm',
      items: [
        {
          soundId: rain.id,
          mode: 'loop',
          loopStartSec: 5,
          loopEndSec: 20,
          loopMode: 'crossfade',
          crossfadeSec: 3,
        },
        { soundId: wind.id },
      ],
    });
    expect(mix.items[0]).toMatchObject({
      soundId: rain.id,
      mode: 'loop',
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: 5,
      loopEndSec: 20,
      loopMode: 'crossfade',
      crossfadeSec: 3,
    });
    // No override: every loop field is null, so the item follows the sound's own values.
    expect(mix.items[1]).toMatchObject({
      soundId: wind.id,
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
      loopMode: null,
      crossfadeSec: null,
    });
    // And on a fresh read, not only in the create response.
    const read = await getMix(user, mix.id);
    expect(read.items[0]).toMatchObject({
      loopStartSec: 5,
      loopEndSec: 20,
      loopMode: 'crossfade',
      crossfadeSec: 3,
    });
    expect(read.items[1]).toMatchObject({
      loopStartSec: null,
      loopEndSec: null,
      loopMode: null,
      crossfadeSec: null,
    });
  });

  it('updates an item’s loop overrides with PATCH', async () => {
    const { user, sounds } = await loopFixture();
    const [rain] = sounds;
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: rain.id }] });
    expect(mix.items[0]).toMatchObject({ loopStartSec: null, loopMode: null, crossfadeSec: null });

    const res = await call(app, user, 'PATCH', `/api/mixes/${mix.id}`, {
      items: [
        {
          soundId: rain.id,
          mode: 'loop',
          loopStartSec: 2,
          loopEndSec: 8,
          loopMode: 'gapless',
          crossfadeSec: 2,
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().items[0]).toMatchObject({
      loopStartSec: 2,
      loopEndSec: 8,
      loopMode: 'gapless',
      crossfadeSec: 2,
    });
    expect((await getMix(user, mix.id)).items[0]).toMatchObject({
      loopStartSec: 2,
      loopEndSec: 8,
      loopMode: 'gapless',
      crossfadeSec: 2,
    });
  });

  it('rejects an override past the sound’s duration or above half the loop', async () => {
    const { user, sounds } = await loopFixture();
    const [rain] = sounds;

    const past = await call(app, user, 'POST', '/api/mixes', {
      name: 'X',
      items: [{ soundId: rain.id, loopStartSec: 5, loopEndSec: 31 }],
    });
    expectError(past, 400, 'validation');
    expect(past.json().error.fields).toHaveProperty('items.0.loopEndSec');

    const tooFat = await call(app, user, 'POST', '/api/mixes', {
      name: 'X',
      items: [
        { soundId: rain.id, loopStartSec: 5, loopEndSec: 9, loopMode: 'crossfade', crossfadeSec: 3 },
      ],
    });
    expectError(tooFat, 400, 'validation');
    expect(tooFat.json().error.fields).toHaveProperty('items.0.crossfadeSec');

    const tooLong = await call(app, user, 'POST', '/api/mixes', {
      name: 'X',
      items: [{ soundId: rain.id, crossfadeSec: 11 }],
    });
    expectError(tooLong, 400, 'validation');

    // Nothing was created.
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });

  it('lets two mixes loop the same sound differently without touching the sound', async () => {
    const { user, sounds } = await loopFixture();
    const [rain] = sounds;
    const a = await createMix(app, user, {
      name: 'A',
      items: [
        {
          soundId: rain.id,
          loopStartSec: 5,
          loopEndSec: 20,
          loopMode: 'crossfade',
          crossfadeSec: 3,
        },
      ],
    });
    const b = await createMix(app, user, {
      name: 'B',
      items: [{ soundId: rain.id, loopStartSec: 1, loopEndSec: 6, loopMode: 'gapless' }],
    });
    expect(a.items[0]).toMatchObject({
      loopStartSec: 5,
      loopEndSec: 20,
      loopMode: 'crossfade',
      crossfadeSec: 3,
    });
    expect(b.items[0]).toMatchObject({
      loopStartSec: 1,
      loopEndSec: 6,
      loopMode: 'gapless',
      crossfadeSec: null,
    });

    // The sound's own row keeps its defaults.
    const after = (await call(app, user, 'GET', `/api/sounds/${rain.id}`)).json();
    expect(after).toMatchObject({
      trackStartSec: null,
      trackEndSec: null,
      loopStartSec: null,
      loopEndSec: null,
      loopMode: 'gapless',
      crossfadeSec: null,
    });
  });
});

describe('delete', () => {
  it('deletes the mix but keeps its sounds', async () => {
    const { user, sounds } = await fixture(2);
    const mix = await createMix(app, user, {
      name: 'M',
      items: sounds.map((s) => ({ soundId: s.id })),
    });
    const res = await call(app, user, 'DELETE', `/api/mixes/${mix.id}`);
    expect(res.statusCode).toBe(204);
    expectError(await call(app, user, 'GET', `/api/mixes/${mix.id}`), 404, 'not_found');
    expectError(await call(app, user, 'DELETE', `/api/mixes/${mix.id}`), 404, 'not_found');
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toHaveLength(2);
    expect((await call(app, user, 'GET', '/api/mixes')).json()).toEqual([]);
  });
});

describe('sound deletion', () => {
  it('makes the sound disappear from every mix', async () => {
    const { user, sounds } = await fixture();
    const [a, b, c] = sounds;
    const m1 = await createMix(app, user, {
      name: 'M1',
      items: [{ soundId: a.id }, { soundId: b.id }, { soundId: c.id }],
    });
    const m2 = await createMix(app, user, { name: 'M2', items: [{ soundId: b.id }] });
    await call(app, user, 'DELETE', `/api/sounds/${b.id}`);
    expect(soundIdsOf(await getMix(user, m1.id))).toEqual([a.id, c.id]);
    expect((await getMix(user, m2.id)).items).toEqual([]);

    // A mix with a gap in its stored positions can still be edited afterwards.
    const res = await call(app, user, 'PATCH', `/api/mixes/${m1.id}`, {
      items: [{ soundId: c.id }, { soundId: a.id }],
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('counts mixes in usage', async () => {
    const { user } = await fixture(0);
    await createMix(app, user);
    await createMix(app, user);
    expect((await call(app, user, 'GET', '/api/me')).json().usage.mixes).toBe(2);
  });
});

describe('listing', () => {
  it('lists mixes by name with their items', async () => {
    const { user, sounds } = await fixture(1);
    await createMix(app, user, { name: 'Zeta' });
    await createMix(app, user, { name: 'Alpha', items: [{ soundId: sounds[0].id }] });
    const list = (await call(app, user, 'GET', '/api/mixes')).json() as Mix[];
    expect(list.map((m) => m.name)).toEqual(['Alpha', 'Zeta']);
    expect(list[0].items).toHaveLength(1);
    expect(list[1].items).toHaveLength(0);
  });

  it('deleting a sound frees its bytes even when a mix used it', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user, { content: wavFile(1) });
    await createMix(app, user, { name: 'M', items: [{ soundId: sound.id }] });
    await call(app, user, 'DELETE', `/api/sounds/${sound.id}`);
    expect((await call(app, user, 'GET', '/api/me')).json().usage.storageBytes).toBe(0);
  });
});

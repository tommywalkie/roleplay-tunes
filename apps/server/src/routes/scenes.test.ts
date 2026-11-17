import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Scene } from '@dnd/shared';
import { buildApp } from '../app.js';
import {
  call,
  createMix,
  createScene,
  expectError,
  signUp,
  uploadSound,
  type TestUser,
} from '../test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

const listScenes = async (user: TestUser) =>
  (await call(app, user, 'GET', '/api/scenes')).json() as Scene[];
const getScene = async (user: TestUser, id: string) =>
  (await call(app, user, 'GET', `/api/scenes/${id}`)).json() as Scene;

describe('create', () => {
  it('appends at the end with positions 0, 1, 2', async () => {
    const user = await signUp(app);
    const a = await createScene(app, user, { name: 'A' });
    const b = await createScene(app, user, { name: 'B' });
    const c = await createScene(app, user, { name: 'C' });
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
    expect((await listScenes(user)).map((s) => s.name)).toEqual(['A', 'B', 'C']);
  });

  it('numbers positions per user', async () => {
    const one = await signUp(app);
    const two = await signUp(app);
    await createScene(app, one, { name: 'A' });
    await createScene(app, one, { name: 'B' });
    expect((await createScene(app, two, { name: 'First' })).position).toBe(0);
  });

  it('appends after the last scene even when one was deleted', async () => {
    const user = await signUp(app);
    const a = await createScene(app, user, { name: 'A' });
    await createScene(app, user, { name: 'B' });
    await call(app, user, 'DELETE', `/api/scenes/${a.id}`);
    await createScene(app, user, { name: 'C' });
    expect((await listScenes(user)).map((s) => s.name)).toEqual(['B', 'C']);
  });

  it('starts empty and accepts members at creation', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const mix = await createMix(app, user);
    const empty = await createScene(app, user, { name: 'Empty' });
    expect(empty).toMatchObject({ soundIds: [], mixIds: [], illustration: { type: 'none' } });
    const full = await createScene(app, user, {
      name: 'Full',
      soundIds: [sound.id],
      mixIds: [mix.id],
    });
    expect(full).toMatchObject({ soundIds: [sound.id], mixIds: [mix.id] });
  });

  it('validates the body', async () => {
    const user = await signUp(app);
    for (const body of [
      {},
      { name: '' },
      { name: ' ' },
      { name: 'n'.repeat(101) },
      { name: 'ok', mixId: 'x' },
      { name: 'ok', position: 4 },
      { name: 'ok', soundIds: 'abc' },
      { name: 'ok', soundIds: ['ghost'] },
      { name: 'ok', mixIds: ['ghost'] },
    ]) {
      expectError(await call(app, user, 'POST', '/api/scenes', body), 400, 'validation');
    }
    expect(await listScenes(user)).toEqual([]);
  });
});

describe('order endpoint', () => {
  async function three() {
    const user = await signUp(app);
    const a = await createScene(app, user, { name: 'A' });
    const b = await createScene(app, user, { name: 'B' });
    const c = await createScene(app, user, { name: 'C' });
    return { user, a, b, c };
  }

  it('reorders the scenes and returns them in the new order', async () => {
    const { user, a, b, c } = await three();
    const res = await call(app, user, 'PUT', '/api/scenes/order', { ids: [c.id, a.id, b.id] });
    expect(res.statusCode, res.body).toBe(200);
    const returned = res.json() as Scene[];
    expect(returned.map((s) => [s.id, s.position])).toEqual([
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ]);
    expect((await listScenes(user)).map((s) => s.id)).toEqual([c.id, a.id, b.id]);
  });

  it('keeps scene members when reordering', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const a = await createScene(app, user, { name: 'A', soundIds: [sound.id] });
    const b = await createScene(app, user, { name: 'B' });
    await call(app, user, 'PUT', '/api/scenes/order', { ids: [b.id, a.id] });
    expect((await getScene(user, a.id)).soundIds).toEqual([sound.id]);
  });

  it('puts a scene created afterwards at the end of the new order', async () => {
    const { user, a, b, c } = await three();
    await call(app, user, 'PUT', '/api/scenes/order', { ids: [c.id, b.id, a.id] });
    const d = await createScene(app, user, { name: 'D' });
    expect((await listScenes(user)).map((s) => s.id)).toEqual([c.id, b.id, a.id, d.id]);
  });

  it.each([
    ['a missing id', (ids: string[]) => ids.slice(0, 2)],
    ['a duplicate id', (ids: string[]) => [ids[0], ids[0], ids[1]]],
    ['a duplicate replacing another', (ids: string[]) => [ids[0], ids[1], ids[1]]],
    ['an extra unknown id', (ids: string[]) => [...ids, 'ghost']],
    ['an unknown id instead of a real one', (ids: string[]) => [ids[0], ids[1], 'ghost']],
    ['an empty list', () => []],
    ['all ids twice', (ids: string[]) => [...ids, ...ids]],
  ])('rejects %s and leaves the order unchanged', async (_label, mutate) => {
    const { user, a, b, c } = await three();
    const res = await call(app, user, 'PUT', '/api/scenes/order', {
      ids: mutate([a.id, b.id, c.id]),
    });
    expectError(res, 400, 'validation');
    expect((await listScenes(user)).map((s) => s.id)).toEqual([a.id, b.id, c.id]);
  });

  it('rejects a body without ids or with extra fields', async () => {
    const { user, a, b, c } = await three();
    expectError(await call(app, user, 'PUT', '/api/scenes/order', {}), 400, 'validation');
    expectError(
      await call(app, user, 'PUT', '/api/scenes/order', { ids: [a.id, b.id, c.id], extra: 1 }),
      400,
      'validation',
    );
  });

  it('accepts an empty list when the user has no scene', async () => {
    const user = await signUp(app);
    const res = await call(app, user, 'PUT', '/api/scenes/order', { ids: [] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('update', () => {
  it('replaces soundIds and mixIds independently', async () => {
    const user = await signUp(app);
    const s1 = await uploadSound(app, user, { fields: { name: 'S1' } });
    const s2 = await uploadSound(app, user, { fields: { name: 'S2' } });
    const m1 = await createMix(app, user, { name: 'M1' });
    const m2 = await createMix(app, user, { name: 'M2' });
    const scene = await createScene(app, user, {
      name: 'Scene',
      soundIds: [s1.id],
      mixIds: [m1.id],
    });

    const onlySounds = (await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, {
      soundIds: [s2.id],
    })).json() as Scene;
    expect(onlySounds).toMatchObject({ soundIds: [s2.id], mixIds: [m1.id] });

    const onlyMixes = (await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, {
      mixIds: [m2.id],
    })).json() as Scene;
    expect(onlyMixes).toMatchObject({ soundIds: [s2.id], mixIds: [m2.id] });

    const both = (await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, {
      soundIds: [s1.id, s2.id],
      mixIds: [],
    })).json() as Scene;
    expect([...both.soundIds].sort()).toEqual([s1.id, s2.id].sort());
    expect(both.mixIds).toEqual([]);

    // The sound side reflects the membership.
    const sound = (await call(app, user, 'GET', `/api/sounds/${s1.id}`)).json();
    expect(sound.sceneIds).toEqual([scene.id]);
    const mix = (await call(app, user, 'GET', `/api/mixes/${m1.id}`)).json();
    expect(mix.sceneIds).toEqual([]);
  });

  it('renames with trimming and keeps the members', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const scene = await createScene(app, user, { name: 'Old', soundIds: [sound.id] });
    const res = await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, { name: '  New  ' });
    expect(res.json()).toMatchObject({ name: 'New', soundIds: [sound.id], position: 0 });
  });

  it('does not change position through PATCH', async () => {
    const user = await signUp(app);
    const scene = await createScene(app, user, { name: 'A' });
    expectError(
      await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, { position: 5 }),
      400,
      'validation',
    );
  });

  it('rejects invalid input and leaves the scene untouched', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const scene = await createScene(app, user, { name: 'S', soundIds: [sound.id] });
    for (const body of [
      { name: '' },
      { name: 'n'.repeat(101) },
      { foo: 1 },
      { soundIds: ['ghost'] },
      { name: 'Changed', mixIds: ['ghost'] },
    ]) {
      expectError(await call(app, user, 'PATCH', `/api/scenes/${scene.id}`, body), 400, 'validation');
    }
    expect(await getScene(user, scene.id)).toEqual(scene);
  });

  it('answers 404 for an unknown scene', async () => {
    const user = await signUp(app);
    expectError(
      await call(app, user, 'PATCH', '/api/scenes/ghost', { name: 'x' }),
      404,
      'not_found',
    );
  });
});

describe('deletion', () => {
  it('deleting a scene keeps its sounds and mixes', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const mix = await createMix(app, user, { name: 'M', items: [{ soundId: sound.id }] });
    const scene = await createScene(app, user, {
      name: 'S',
      soundIds: [sound.id],
      mixIds: [mix.id],
    });
    const res = await call(app, user, 'DELETE', `/api/scenes/${scene.id}`);
    expect(res.statusCode).toBe(204);
    expectError(await call(app, user, 'GET', `/api/scenes/${scene.id}`), 404, 'not_found');
    expectError(await call(app, user, 'DELETE', `/api/scenes/${scene.id}`), 404, 'not_found');

    const keptSound = (await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json();
    expect(keptSound.sceneIds).toEqual([]);
    const keptMix = (await call(app, user, 'GET', `/api/mixes/${mix.id}`)).json();
    expect(keptMix.sceneIds).toEqual([]);
    expect(keptMix.items).toHaveLength(1);
  });

  it('deleting a scene does not touch the other scenes of the same sound', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const s1 = await createScene(app, user, { name: 'One', soundIds: [sound.id] });
    const s2 = await createScene(app, user, { name: 'Two', soundIds: [sound.id] });
    await call(app, user, 'DELETE', `/api/scenes/${s1.id}`);
    expect((await getScene(user, s2.id)).soundIds).toEqual([sound.id]);
    expect((await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json().sceneIds).toEqual([
      s2.id,
    ]);
  });

  it('deleting a sound removes it from the scene', async () => {
    const user = await signUp(app);
    const keep = await uploadSound(app, user, { fields: { name: 'Keep' } });
    const doomed = await uploadSound(app, user, { fields: { name: 'Doomed' } });
    const scene = await createScene(app, user, {
      name: 'S',
      soundIds: [keep.id, doomed.id],
    });
    await call(app, user, 'DELETE', `/api/sounds/${doomed.id}`);
    expect((await getScene(user, scene.id)).soundIds).toEqual([keep.id]);
  });

  it('deleting a mix removes it from the scene', async () => {
    const user = await signUp(app);
    const keep = await createMix(app, user, { name: 'Keep' });
    const doomed = await createMix(app, user, { name: 'Doomed' });
    const scene = await createScene(app, user, { name: 'S', mixIds: [keep.id, doomed.id] });
    await call(app, user, 'DELETE', `/api/mixes/${doomed.id}`);
    expect((await getScene(user, scene.id)).mixIds).toEqual([keep.id]);
  });
});

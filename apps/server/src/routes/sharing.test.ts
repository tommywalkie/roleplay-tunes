import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { Library, Me, Mix, Scene, Sound } from '@dnd/shared';
import { buildApp } from '../app.js';
import {
  call,
  createMix,
  createScene,
  expectError,
  multipart,
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

const sounds = async (user: TestUser): Promise<Sound[]> =>
  (await call(app, user, 'GET', '/api/sounds')).json();
const mixes = async (user: TestUser): Promise<Mix[]> =>
  (await call(app, user, 'GET', '/api/mixes')).json();
const scene = async (user: TestUser, id: string): Promise<Scene> =>
  (await call(app, user, 'GET', `/api/scenes/${id}`)).json();
const library = async (user: TestUser): Promise<Library> =>
  (await call(app, user, 'GET', '/api/library')).json();
const me = async (user: TestUser): Promise<Me> => (await call(app, user, 'GET', '/api/me')).json();

async function publicSound(owner: TestUser, name = 'Rain'): Promise<Sound> {
  const sound = await uploadSound(app, owner, { fields: { name } });
  const res = await call(app, owner, 'PATCH', `/api/sounds/${sound.id}`, { isPublic: true });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function pngFile(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
}

function uploadImage(user: TestUser, kind: string, id: string, content: Buffer) {
  const body = multipart({}, { filename: 'cover.png', contentType: 'image/png', content });
  return app.inject({
    method: 'PUT',
    url: `/api/${kind}/${id}/image`,
    payload: body.payload,
    headers: { ...body.headers, cookie: user.cookie },
  });
}

describe('public sounds', () => {
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
  });

  it('are private by default and carry description and license', async () => {
    const sound = await uploadSound(app, a);
    expect(sound).toMatchObject({ isPublic: false, access: 'owner', description: null, license: null });
    const res = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, {
      description: '  Heavy rain on a roof  ',
      license: 'CC BY 4.0',
    });
    expect(res.json()).toMatchObject({ description: 'Heavy rain on a roof', license: 'CC BY 4.0' });
    const cleared = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { description: '' });
    expect(cleared.json().description).toBeNull();
    expectError(
      await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { license: 'x'.repeat(201) }),
      400,
      'validation',
    );
    expect((await library(b)).sounds.some((s) => s.id === sound.id)).toBe(false);
  });

  it('carry the seven detail fields of where a sound comes from', async () => {
    const sound = await uploadSound(app, a, { fields: { name: 'Bagpipes' } });
    const details = {
      artists: 'The Chieftains',
      year: '1975',
      movie: 'Braveheart',
      game: 'The Witcher 3',
      tv: 'Outlander',
      album: 'Celtic Dawn',
      url: 'https://example.com/bagpipes',
    };
    const res = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, details);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject(details);
    // They come back on the list and on a single read, not only on the save.
    expect((await sounds(a)).find((s) => s.id === sound.id)).toMatchObject(details);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json()).toMatchObject(details);
  });

  it('clear a detail field to null with an empty string', async () => {
    const sound = await uploadSound(app, a, { fields: { name: 'Lute' } });
    await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { artists: 'A bard' });
    const cleared = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { artists: '' });
    expect(cleared.json().artists).toBeNull();
  });

  it('refuse a detail url that is not an http address', async () => {
    const sound = await uploadSound(app, a, { fields: { name: 'Horn' } });
    const res = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, {
      url: 'ftp://example.com/horn',
    });
    expectError(res, 400, 'validation');
    expect(res.json().error.fields).toHaveProperty('url');
  });

  it('cannot have their details changed by whoever added them from the library', async () => {
    const sound = await publicSound(a, 'Drum');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expectError(
      await call(app, b, 'PATCH', `/api/sounds/${sound.id}`, { artists: 'Not mine' }),
      403,
      'forbidden',
    );
    expect((await sounds(a)).find((s) => s.id === sound.id)?.artists).toBeNull();
  });

  it('show in the library, and can be added by others only', async () => {
    const sound = await publicSound(a, 'Wind');
    const seen = (await library(b)).sounds.find((s) => s.id === sound.id);
    expect(seen).toMatchObject({ access: 'available', ownerName: 'Test User' });
    expect((await library(a)).sounds.find((s) => s.id === sound.id)?.access).toBe('owner');

    expectError(await call(app, a, 'PUT', `/api/library/sounds/${sound.id}`), 409, 'conflict');
    expect((await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
    expect((await library(b)).sounds.find((s) => s.id === sound.id)?.access).toBe('added');
    const listed = (await sounds(b)).find((s) => s.id === sound.id);
    expect(listed).toMatchObject({ access: 'added', ownerName: 'Test User' });
  });

  it('do not count against the storage of who adds them', async () => {
    const c = await signUp(app);
    const sound = await publicSound(a, 'Fire');
    await call(app, c, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await me(c)).usage.storageBytes).toBe(0);
  });

  it('serve their audio to everyone, private ones to the owner only', async () => {
    const shared = await publicSound(a, 'Birds');
    const own = await uploadSound(app, a);
    expect((await call(app, b, 'GET', shared.audioUrl)).statusCode).toBe(200);
    expectError(await call(app, b, 'GET', own.audioUrl), 404, 'not_found');
  });

  it('can be tuned, put in mixes and scenes by who added them, not edited', async () => {
    const sound = await publicSound(a, 'Crowd');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);

    expectError(
      await call(app, b, 'PATCH', `/api/sounds/${sound.id}`, { name: 'Mine now' }),
      403,
      'forbidden',
    );
    expectError(await call(app, b, 'DELETE', `/api/sounds/${sound.id}`), 403, 'forbidden');
    expectError(await uploadImage(b, 'sounds', sound.id, await pngFile()), 404, 'not_found');

    const tuned = await call(app, b, 'PATCH', `/api/sounds/${sound.id}`, { defaultVolume: 0.2 });
    expect(tuned.statusCode, tuned.body).toBe(200);
    expect(tuned.json().defaultVolume).toBe(0.2);
    expect((await sounds(a)).find((s) => s.id === sound.id)?.defaultVolume).toBe(0.8);

    const mix = await createMix(app, b, { name: 'Tavern', items: [{ soundId: sound.id }] });
    expect(mix.items[0].volume).toBe(0.2);
    const sc = await createScene(app, b, { name: 'Inn', soundIds: [sound.id] });
    expect(sc.soundIds).toEqual([sound.id]);
  });

  it('leave everyone else when made private again', async () => {
    const sound = await publicSound(a, 'Bells');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    const mix = await createMix(app, b, { name: 'Church', items: [{ soundId: sound.id }] });
    const sc = await createScene(app, b, { name: 'Chapel', soundIds: [sound.id] });

    await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { isPublic: false });

    expect((await sounds(b)).some((s) => s.id === sound.id)).toBe(false);
    expect((await mixes(b)).find((m) => m.id === mix.id)?.items).toEqual([]);
    expect((await scene(b, sc.id)).soundIds).toEqual([]);
    expect((await library(b)).sounds.some((s) => s.id === sound.id)).toBe(false);
    expect((await sounds(a)).some((s) => s.id === sound.id)).toBe(true);
  });

  it('leave everyone else when deleted', async () => {
    const sound = await publicSound(a, 'Thunder');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await call(app, a, 'DELETE', `/api/sounds/${sound.id}`)).statusCode).toBe(204);
    expect((await sounds(b)).some((s) => s.id === sound.id)).toBe(false);
  });

  it('can be removed from a library, with their uses', async () => {
    const sound = await publicSound(a, 'Owl');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    const mix = await createMix(app, b, { name: 'Night', items: [{ soundId: sound.id }] });
    expect((await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
    expect((await sounds(b)).some((s) => s.id === sound.id)).toBe(false);
    expect((await mixes(b)).find((m) => m.id === mix.id)?.items).toEqual([]);
    expectError(await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`), 404, 'not_found');
  });

  it('report how many users have them, nobody on a fresh one', async () => {
    // A create reports 0 without counting anything: it is brand new.
    const fresh = await uploadSound(app, a, { fields: { name: 'Crickets' } });
    expect(fresh.addedCount).toBe(0);

    const sound = await publicSound(a, 'Crickets');
    expect(sound.addedCount).toBe(0);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json()).toMatchObject({
      addedCount: 0,
    });
    expect((await sounds(a)).find((s) => s.id === sound.id)).toMatchObject({ addedCount: 0 });
    expect((await library(a)).sounds.find((s) => s.id === sound.id)).toMatchObject({
      addedCount: 0,
    });

    // The count is only other accounts: b is the first to have it, and the owner sees 1.
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json().addedCount).toBe(1);
    expect((await sounds(a)).find((s) => s.id === sound.id)?.addedCount).toBe(1);
    expect((await library(a)).sounds.find((s) => s.id === sound.id)?.addedCount).toBe(1);
  });

  it('go back to 0 when the last library removes them', async () => {
    const sound = await publicSound(a, 'Crickets');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json().addedCount).toBe(1);

    await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json().addedCount).toBe(0);
  });

  it('report 0 when a patch unpublishes them', async () => {
    const sound = await publicSound(a, 'Marsh frogs');
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await call(app, a, 'GET', `/api/sounds/${sound.id}`)).json().addedCount).toBe(1);

    const res = await call(app, a, 'PATCH', `/api/sounds/${sound.id}`, { isPublic: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().addedCount).toBe(0);
  });
});

describe('public mixes', () => {
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
  });

  it('only hold public sounds', async () => {
    const own = await uploadSound(app, a);
    const res = await call(app, a, 'POST', '/api/mixes', {
      name: 'Forest',
      isPublic: true,
      items: [{ soundId: own.id }],
    });
    expectError(res, 400, 'validation');

    const shared = await publicSound(a, 'Leaves');
    const mix = await createMix(app, a, {
      name: 'Forest',
      description: 'Wind in the trees',
      isPublic: true,
      items: [{ soundId: shared.id }],
    });
    expect(mix).toMatchObject({ isPublic: true, description: 'Wind in the trees' });
    expectError(
      await call(app, a, 'PATCH', `/api/mixes/${mix.id}`, {
        items: [{ soundId: shared.id }, { soundId: own.id }],
      }),
      400,
      'validation',
    );
    expectError(
      await call(app, a, 'PATCH', `/api/sounds/${shared.id}`, { isPublic: false }),
      409,
      'conflict',
    );
  });

  it('bring their sounds to who adds them, with personal volumes', async () => {
    const s1 = await publicSound(a, 'Waves');
    const s2 = await publicSound(a, 'Gulls');
    const mix = await createMix(app, a, {
      name: 'Harbor',
      isPublic: true,
      items: [
        { soundId: s1.id, volume: 0.5 },
        { soundId: s2.id, volume: 0.6 },
      ],
    });
    expect((await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`)).statusCode).toBe(204);

    const ids = (await sounds(b)).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([s1.id, s2.id]));
    expect((await mixes(b)).find((m) => m.id === mix.id)?.access).toBe('added');

    expectError(
      await call(app, b, 'PATCH', `/api/mixes/${mix.id}`, { name: 'Taken' }),
      403,
      'forbidden',
    );
    const tuned = await call(app, b, 'PUT', `/api/mixes/${mix.id}/volumes`, {
      volumes: { [s1.id]: 0.1 },
    });
    expect(tuned.statusCode, tuned.body).toBe(200);
    expect(tuned.json().items.map((i: { volume: number }) => i.volume)).toEqual([0.1, 0.6]);
    expect((await mixes(a)).find((m) => m.id === mix.id)?.items[0].volume).toBe(0.5);
    expectError(
      await call(app, a, 'PUT', `/api/mixes/${mix.id}/volumes`, { volumes: {} }),
      400,
      'validation',
    );

    const sc = await createScene(app, b, { name: 'Docks', mixIds: [mix.id] });
    expect(sc.mixIds).toEqual([mix.id]);
  });

  it('keep a sound added directly while a mix of the library uses it', async () => {
    const sound = await publicSound(a, 'Rope');
    const mix = await createMix(app, a, {
      name: 'Ship',
      isPublic: true,
      items: [{ soundId: sound.id }],
    });
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    expectError(await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`), 409, 'conflict');
    expect((await call(app, b, 'DELETE', `/api/library/mixes/${mix.id}`)).statusCode).toBe(204);
    expect((await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
  });

  it('take their sounds away when removed or made private', async () => {
    const sound = await publicSound(a, 'Oars');
    const mix = await createMix(app, a, {
      name: 'Galley',
      isPublic: true,
      items: [{ soundId: sound.id }],
    });
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    const own = await createMix(app, b, { name: 'Mine', items: [{ soundId: sound.id }] });
    const sc = await createScene(app, b, { name: 'Sea', mixIds: [mix.id] });

    await call(app, a, 'PATCH', `/api/mixes/${mix.id}`, { isPublic: false });

    expect((await mixes(b)).some((m) => m.id === mix.id)).toBe(false);
    expect((await sounds(b)).some((s) => s.id === sound.id)).toBe(false);
    expect((await mixes(b)).find((m) => m.id === own.id)?.items).toEqual([]);
    expect((await scene(b, sc.id)).mixIds).toEqual([]);
  });

  it('report how many users have them, nobody on a fresh one', async () => {
    const fresh = await createMix(app, a, { name: 'Pond' });
    expect(fresh.addedCount).toBe(0);

    const sound = await publicSound(a, 'Crickets');
    const mix = await createMix(app, a, {
      name: 'Pond',
      isPublic: true,
      items: [{ soundId: sound.id }],
    });
    expect(mix.addedCount).toBe(0);
    expect((await call(app, a, 'GET', `/api/mixes/${mix.id}`)).json()).toMatchObject({
      addedCount: 0,
    });
    expect((await mixes(a)).find((m) => m.id === mix.id)).toMatchObject({ addedCount: 0 });

    // Only other accounts count: b adds it, and its owner sees 1.
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    expect((await call(app, a, 'GET', `/api/mixes/${mix.id}`)).json().addedCount).toBe(1);
    expect((await mixes(a)).find((m) => m.id === mix.id)?.addedCount).toBe(1);
  });

  it('go back to 0 when the last library removes them', async () => {
    const sound = await publicSound(a, 'Crickets');
    const mix = await createMix(app, a, {
      name: 'Pond',
      isPublic: true,
      items: [{ soundId: sound.id }],
    });
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    expect((await call(app, a, 'GET', `/api/mixes/${mix.id}`)).json().addedCount).toBe(1);

    await call(app, b, 'DELETE', `/api/library/mixes/${mix.id}`);
    expect((await call(app, a, 'GET', `/api/mixes/${mix.id}`)).json().addedCount).toBe(0);
  });

  it('report 0 when a patch unpublishes them', async () => {
    const sound = await publicSound(a, 'Crickets');
    const mix = await createMix(app, a, {
      name: 'Pond',
      isPublic: true,
      items: [{ soundId: sound.id }],
    });
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    expect((await call(app, a, 'GET', `/api/mixes/${mix.id}`)).json().addedCount).toBe(1);

    const res = await call(app, a, 'PATCH', `/api/mixes/${mix.id}`, { isPublic: false });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().addedCount).toBe(0);
  });
});

describe('reusing images', () => {
  it('lists own and added images, counts each file once, frees it when unused', async () => {
    const a = await signUp(app);
    const b = await signUp(app);
    const sound = await publicSound(a, 'Lute');
    expect((await uploadImage(a, 'sounds', sound.id, await pngFile())).statusCode).toBe(204);
    const withImage = (await sounds(a)).find((s) => s.id === sound.id)!;
    if (withImage.illustration.type !== 'image') throw new Error('expected an image');
    const key = withImage.illustration.url.split('/').pop()!;
    const usage = (await me(a)).usage.storageBytes;

    const mix = await createMix(app, a, {
      name: 'Bard',
      illustration: { type: 'image', imageKey: key },
    });
    expect(mix.illustration).toEqual(withImage.illustration);
    expect((await me(a)).usage.storageBytes).toBe(usage);

    expect((await call(app, b, 'GET', '/api/images')).json()).toEqual([]);
    await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`);
    expect((await call(app, b, 'GET', '/api/images')).json()).toEqual([
      { key, url: `/api/images/${key}` },
    ]);
    const sc = await createScene(app, b, {
      name: 'Hall',
      illustration: { type: 'image', imageKey: key },
    });
    expect((await me(b)).usage.storageBytes).toBe(0);
    expect((await call(app, b, 'GET', `/api/images/${key}`)).statusCode).toBe(200);

    const stranger = await signUp(app);
    expectError(
      await call(app, stranger, 'POST', '/api/scenes', {
        name: 'Nope',
        illustration: { type: 'image', imageKey: '00000000-0000-4000-8000-000000000000' },
      }),
      400,
      'validation',
    );

    await call(app, a, 'DELETE', `/api/sounds/${sound.id}`);
    await call(app, a, 'DELETE', `/api/mixes/${mix.id}`);
    expect((await call(app, b, 'GET', `/api/images/${key}`)).statusCode).toBe(200);
    await call(app, b, 'PATCH', `/api/scenes/${sc.id}`, { illustration: { type: 'none' } });
    expect((await call(app, a, 'GET', `/api/images/${key}`)).statusCode).toBe(404);
    expect((await me(a)).usage.storageBytes).toBe(0);
  });
});

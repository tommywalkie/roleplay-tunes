import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  SYNONYM_MAX,
  SYNONYMS_PER_ITEM,
  type Category,
  type Library,
  type Mix,
  type Scene,
  type Sound,
} from '@dnd/shared';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { categories, soundCategories, soundSynonyms, synonyms } from '../db/schema.js';
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

const soundOf = async (user: TestUser, id: string): Promise<Sound> =>
  (await call(app, user, 'GET', `/api/sounds/${id}`)).json();
const mixOf = async (user: TestUser, id: string): Promise<Mix> =>
  (await call(app, user, 'GET', `/api/mixes/${id}`)).json();
const sceneOf = async (user: TestUser, id: string): Promise<Scene> =>
  (await call(app, user, 'GET', `/api/scenes/${id}`)).json();
const library = async (user: TestUser): Promise<Library> =>
  (await call(app, user, 'GET', '/api/library')).json();
const synonymsOf = async (user: TestUser): Promise<string[]> =>
  (await call(app, user, 'GET', '/api/synonyms')).json();
const categoriesOf = async (user: TestUser): Promise<Category[]> =>
  (await call(app, user, 'GET', '/api/categories')).json();

async function patch(user: TestUser, url: string, body: unknown) {
  const res = await call(app, user, 'PATCH', url, body);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function category(user: TestUser, name: string, color = '#3b5b8c'): Promise<Category> {
  const res = await call(app, user, 'POST', '/api/categories', { name, color });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

async function publicSound(owner: TestUser, name = 'Rain'): Promise<Sound> {
  const sound = await uploadSound(app, owner, { fields: { name } });
  return patch(owner, `/api/sounds/${sound.id}`, { isPublic: true });
}

/** A public sound of `owner`, added to the library of `adder`. */
async function addedSound(owner: TestUser, adder: TestUser, name = 'Rain'): Promise<Sound> {
  const sound = await publicSound(owner, name);
  expect((await call(app, adder, 'PUT', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
  return sound;
}

const mine = (...labels: string[]) => labels.map((label) => ({ label, mine: true }));
const theirs = (...labels: string[]) => labels.map((label) => ({ label, mine: false }));

describe('synonyms of the owner', () => {
  let a: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
  });

  it('are trimmed, kept once per exact text, sorted, and suggested back', async () => {
    const sound = await uploadSound(app, a);
    const saved: Sound = await patch(a, `/api/sounds/${sound.id}`, {
      synonyms: ['  storm  ', 'rain', 'storm', 'Storm'],
    });
    expect(saved.synonyms).toEqual(mine('rain', 'storm', 'Storm'));
    expect((await soundOf(a, sound.id)).synonyms).toEqual(saved.synonyms);
    expect(await synonymsOf(a)).toEqual(expect.arrayContaining(['rain', 'storm', 'Storm']));
  });

  it('replace the previous list, and a synonym no item carries is deleted', async () => {
    const sound = await uploadSound(app, a);
    const mix = await createMix(app, a, { name: 'Night', synonyms: ['kept-elsewhere'] });
    await patch(a, `/api/sounds/${sound.id}`, { synonyms: ['dropped', 'kept-elsewhere'] });
    expect(await synonymsOf(a)).toEqual(expect.arrayContaining(['dropped', 'kept-elsewhere']));

    const saved: Sound = await patch(a, `/api/sounds/${sound.id}`, { synonyms: ['new'] });
    expect(saved.synonyms).toEqual(mine('new'));
    const known = await synonymsOf(a);
    expect(known).not.toContain('dropped');
    expect(known).toContain('kept-elsewhere');
    expect((await mixOf(a, mix.id)).synonyms).toEqual(mine('kept-elsewhere'));
  });

  it('are left alone when the list is not sent', async () => {
    const sound = await uploadSound(app, a);
    await patch(a, `/api/sounds/${sound.id}`, { synonyms: ['still here'] });
    const renamed: Sound = await patch(a, `/api/sounds/${sound.id}`, { name: 'Renamed' });
    expect(renamed.synonyms).toEqual(mine('still here'));
  });

  it('are set on mixes and scenes when created and updated', async () => {
    const mix = await createMix(app, a, { name: 'Tavern', synonyms: ['inn', 'pub'] });
    expect(mix.synonyms).toEqual(mine('inn', 'pub'));
    const scene = await createScene(app, a, { name: 'Harbor', synonyms: ['docks'] });
    expect(scene.synonyms).toEqual(mine('docks'));
    expect((await patch(a, `/api/scenes/${scene.id}`, { synonyms: ['port'] })).synonyms).toEqual(mine('port'));
    expect((await sceneOf(a, scene.id)).synonyms).toEqual(mine('port'));
  });

  it(`take at most ${SYNONYMS_PER_ITEM} per item and ${SYNONYM_MAX} characters each`, async () => {
    const sound = await uploadSound(app, a);
    const url = `/api/sounds/${sound.id}`;
    const many = Array.from({ length: SYNONYMS_PER_ITEM }, (_, i) => `word ${i}`);
    expect((await patch(a, url, { synonyms: many })).synonyms).toHaveLength(SYNONYMS_PER_ITEM);
    expectError(await call(app, a, 'PATCH', url, { synonyms: [...many, 'one more'] }), 400, 'validation');

    const longest = 'x'.repeat(SYNONYM_MAX);
    expect((await patch(a, url, { synonyms: [longest] })).synonyms).toEqual(mine(longest));
    expectError(await call(app, a, 'PATCH', url, { synonyms: [`${longest}x`] }), 400, 'validation');
    expectError(await call(app, a, 'PATCH', url, { synonyms: ['   '] }), 400, 'validation');
    expectError(await call(app, a, 'PATCH', url, { synonyms: ['tab\there'] }), 400, 'validation');
    expect((await soundOf(a, sound.id)).synonyms).toEqual(mine(longest));
  });

  it('belong to each user: another user’s list of suggestions stays apart', async () => {
    const other = await signUp(app);
    expect(await synonymsOf(other)).toEqual([]);
  });
});

describe('synonyms of a user who added the item', () => {
  let a: TestUser;
  let b: TestUser;
  let c: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
    c = await signUp(app);
  });

  it('show next to the owner’s for that user only; each user changes only their own', async () => {
    const sound = await addedSound(a, b);
    await patch(a, `/api/sounds/${sound.id}`, { synonyms: ['shared', 'owner-word'] });
    const asB: Sound = await patch(b, `/api/sounds/${sound.id}`, { synonyms: ['b-word', 'shared'] });

    // An exact text both wrote shows once, as the viewer's own.
    expect(asB.synonyms).toEqual([...mine('b-word'), ...theirs('owner-word'), ...mine('shared')]);
    expect((await soundOf(a, sound.id)).synonyms).toEqual(mine('owner-word', 'shared'));
    expect((await library(c)).sounds.find((s) => s.id === sound.id)?.synonyms).toEqual(
      theirs('owner-word', 'shared'),
    );
    expect((await library(b)).sounds.find((s) => s.id === sound.id)?.synonyms).toEqual(asB.synonyms);

    // B clearing their list leaves the owner's in place.
    const cleared: Sound = await patch(b, `/api/sounds/${sound.id}`, { synonyms: [] });
    expect(cleared.synonyms).toEqual(theirs('owner-word', 'shared'));
    expect(await synonymsOf(b)).toEqual([]);
    expect(await synonymsOf(a)).toEqual(expect.arrayContaining(['owner-word', 'shared']));
  });

  it('can be set on an added mix, with sceneIds, but not with owner fields', async () => {
    const sound = await publicSound(a, 'Bells');
    const mix = await createMix(app, a, {
      name: 'Market',
      isPublic: true,
      items: [{ soundId: sound.id }],
      synonyms: ['bazaar'],
    });
    expect((await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`)).statusCode).toBe(204);
    const asB: Mix = await patch(b, `/api/mixes/${mix.id}`, { synonyms: ['souk'] });
    expect(asB.synonyms).toEqual([...theirs('bazaar'), ...mine('souk')]);
    expect((await mixOf(a, mix.id)).synonyms).toEqual(mine('bazaar'));
    expectError(
      await call(app, b, 'PATCH', `/api/mixes/${mix.id}`, { name: 'Mine', synonyms: ['x'] }),
      403,
      'forbidden',
    );
    expect((await mixOf(b, mix.id)).synonyms).toEqual(asB.synonyms);
  });

  it('cannot be put on an item the user cannot use', async () => {
    const sound = await publicSound(a, 'Wind');
    expectError(await call(app, b, 'PATCH', `/api/sounds/${sound.id}`, { synonyms: ['nope'] }), 404, 'not_found');
    expect(await synonymsOf(b)).not.toContain('nope');
  });
});

describe('categories', () => {
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
  });

  it('are created, listed by name, renamed, recolored and deleted by their owner', async () => {
    const res = await call(app, a, 'POST', '/api/categories', { name: 'Woods', color: '#5A7D3A' });
    expect(res.statusCode, res.body).toBe(201);
    const woods: Category = res.json();
    expect(woods).toMatchObject({ name: 'Woods', color: '#5a7d3a', icon: null });
    const inn = await category(a, 'Inn');
    expect((await categoriesOf(a)).map((c) => c.name)).toEqual(['Inn', 'Woods']);

    const changed = await patch(a, `/api/categories/${woods.id}`, { name: 'Forest', color: '#2f6f62' });
    expect(changed).toMatchObject({ id: woods.id, name: 'Forest', color: '#2f6f62' });
    expect((await categoriesOf(a)).map((c) => c.name)).toEqual(['Forest', 'Inn']);

    expect((await call(app, a, 'DELETE', `/api/categories/${inn.id}`)).statusCode).toBe(204);
    expect((await categoriesOf(a)).map((c) => c.id)).toEqual([woods.id]);
    expect(await categoriesOf(b)).toEqual([]);
  });

  it('have names unique per user, by exact text', async () => {
    const tavern = await category(a, 'Tavern');
    expectError(await call(app, a, 'POST', '/api/categories', { name: 'Tavern', color: '#8b3a3a' }), 409, 'conflict');
    await category(a, 'tavern');
    await category(b, 'Tavern');
    const other = await category(a, 'Cellar');
    expectError(await call(app, a, 'PATCH', `/api/categories/${other.id}`, { name: 'Tavern' }), 409, 'conflict');
    expect((await patch(a, `/api/categories/${tavern.id}`, { name: 'Tavern', color: '#8b3a3a' })).color).toBe(
      '#8b3a3a',
    );
  });

  it('reject an unknown icon, a bad color, and a name too long or empty', async () => {
    const post = (body: unknown) => call(app, a, 'POST', '/api/categories', body);
    expectError(await post({ name: 'Icon', color: '#3b5b8c', iconId: 'nope:nothing' }), 400, 'validation');
    expectError(await post({ name: 'Color', color: 'red' }), 400, 'validation');
    expectError(await post({ name: 'x'.repeat(41), color: '#3b5b8c' }), 400, 'validation');
    expectError(await post({ name: '  ', color: '#3b5b8c' }), 400, 'validation');
    const kept = await category(a, 'Kept');
    expectError(await call(app, a, 'PATCH', `/api/categories/${kept.id}`, { iconId: 'nope:nothing' }), 400, 'validation');
    expect((await categoriesOf(a)).find((c) => c.id === kept.id)?.icon).toBeNull();
  });

  it('of another user cannot be changed or deleted', async () => {
    const own = await category(a, 'Private');
    expectError(await call(app, b, 'PATCH', `/api/categories/${own.id}`, { name: 'Taken' }), 404, 'not_found');
    expectError(await call(app, b, 'DELETE', `/api/categories/${own.id}`), 404, 'not_found');
    expect((await categoriesOf(a)).find((c) => c.id === own.id)?.name).toBe('Private');
  });

  it('go several on an item, each user seeing only their own', async () => {
    const sound = await addedSound(a, b, 'Gulls');
    const aSea = await category(a, 'Sea');
    const bCoast = await category(b, 'Coast');
    const bBirds = await category(b, 'Birds');
    expect((await patch(a, `/api/sounds/${sound.id}`, { categoryIds: [aSea.id] })).categoryIds).toEqual([aSea.id]);
    const asB: Sound = await patch(b, `/api/sounds/${sound.id}`, {
      categoryIds: [bCoast.id, bBirds.id, bCoast.id],
    });
    // Sorted by name, each once.
    expect(asB.categoryIds).toEqual([bBirds.id, bCoast.id]);
    expect((await soundOf(a, sound.id)).categoryIds).toEqual([aSea.id]);
    expect((await library(b)).sounds.find((s) => s.id === sound.id)?.categoryIds).toEqual(asB.categoryIds);
  });

  it('reject unknown or foreign ids on an item, and change nothing', async () => {
    const sound = await uploadSound(app, b);
    const own = await category(b, 'Own');
    await patch(b, `/api/sounds/${sound.id}`, { categoryIds: [own.id] });
    const foreign = await category(a, 'Foreign');
    const url = `/api/sounds/${sound.id}`;
    expectError(await call(app, b, 'PATCH', url, { categoryIds: ['does-not-exist'] }), 400, 'validation');
    expectError(await call(app, b, 'PATCH', url, { categoryIds: [own.id, foreign.id] }), 400, 'validation');
    expectError(
      await call(app, b, 'PATCH', url, { name: 'Changed', categoryIds: [foreign.id] }),
      400,
      'validation',
    );
    const after = await soundOf(b, sound.id);
    expect(after.categoryIds).toEqual([own.id]);
    expect(after.name).not.toBe('Changed');
  });

  it('come off every item when deleted, sounds, mixes and scenes alike', async () => {
    const gone = await category(a, 'Gone');
    const stays = await category(a, 'Stays');
    const both = [gone.id, stays.id];
    const sound = await uploadSound(app, a);
    await patch(a, `/api/sounds/${sound.id}`, { categoryIds: both });
    const mix = await createMix(app, a, { name: 'M', categoryIds: both });
    const scene = await createScene(app, a, { name: 'S', categoryIds: both });

    expect((await call(app, a, 'DELETE', `/api/categories/${gone.id}`)).statusCode).toBe(204);
    expect((await soundOf(a, sound.id)).categoryIds).toEqual([stays.id]);
    expect((await mixOf(a, mix.id)).categoryIds).toEqual([stays.id]);
    expect((await sceneOf(a, scene.id)).categoryIds).toEqual([stays.id]);
  });
});

describe('losing access to an item', () => {
  let a: TestUser;
  let b: TestUser;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
  });

  /** B tags A's sound with a synonym and a category of their own. */
  async function taggedByB(sound: Sound, word: string) {
    const own = await category(b, `Cat ${word}`);
    await patch(b, `/api/sounds/${sound.id}`, { synonyms: [word], categoryIds: [own.id] });
    expect(await synonymsOf(b)).toContain(word);
    return own;
  }

  /** After B gets the sound back, none of their old tags are on it. */
  async function expectUntaggedOnReturn(sound: Sound, word: string, own: Category) {
    expect(await synonymsOf(b)).not.toContain(word);
    // The category itself stays: only its link to the item is gone.
    expect((await categoriesOf(b)).map((c) => c.id)).toContain(own.id);
    expect(db.select().from(soundCategories).where(eq(soundCategories.tagId, own.id)).all()).toEqual([]);
    expect((await call(app, b, 'PUT', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
    const back = await soundOf(b, sound.id);
    expect(back.synonyms.filter((s) => s.mine)).toEqual([]);
    expect(back.categoryIds).toEqual([]);
  }

  it('when the owner makes it private removes the user’s synonyms and category links', async () => {
    const sound = await addedSound(a, b, 'Private soon');
    const own = await taggedByB(sound, 'made-private');
    await patch(a, `/api/sounds/${sound.id}`, { isPublic: false });
    await patch(a, `/api/sounds/${sound.id}`, { isPublic: true });
    await expectUntaggedOnReturn(sound, 'made-private', own);
  });

  it('when the user removes it from their library does the same', async () => {
    const sound = await addedSound(a, b, 'Removed');
    const own = await taggedByB(sound, 'removed-from-library');
    expect((await call(app, b, 'DELETE', `/api/library/sounds/${sound.id}`)).statusCode).toBe(204);
    await expectUntaggedOnReturn(sound, 'removed-from-library', own);
  });

  it('keeps the owner’s own synonyms and categories on the item', async () => {
    const sound = await addedSound(a, b, 'Owner keeps');
    const aCat = await category(a, 'Owner category');
    await patch(a, `/api/sounds/${sound.id}`, { synonyms: ['owner-keeps'], categoryIds: [aCat.id] });
    await taggedByB(sound, 'b-loses');
    await patch(a, `/api/sounds/${sound.id}`, { isPublic: false });
    const own = await soundOf(a, sound.id);
    expect(own.synonyms).toEqual(mine('owner-keeps'));
    expect(own.categoryIds).toEqual([aCat.id]);
  });

  it('for a mix made private removes the user’s tags on that mix', async () => {
    const sound = await publicSound(a, 'Mixed');
    const mix = await createMix(app, a, { name: 'Shared mix', isPublic: true, items: [{ soundId: sound.id }] });
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    const own = await category(b, 'Mix category');
    await patch(b, `/api/mixes/${mix.id}`, { synonyms: ['mix-word'], categoryIds: [own.id] });

    await patch(a, `/api/mixes/${mix.id}`, { isPublic: false });
    expect(await synonymsOf(b)).not.toContain('mix-word');
    await patch(a, `/api/mixes/${mix.id}`, { isPublic: true });
    await call(app, b, 'PUT', `/api/library/mixes/${mix.id}`);
    const back = await mixOf(b, mix.id);
    expect(back.synonyms).toEqual([]);
    expect(back.categoryIds).toEqual([]);
  });

  it('when the owner deletes their account removes what others set on their items', async () => {
    const owner = await signUp(app);
    const sound = await addedSound(owner, b, 'Leaving');
    await taggedByB(sound, 'owner-left');
    const res = await call(app, owner, 'DELETE', '/api/me', { email: owner.email });
    expect(res.statusCode, res.body).toBe(204);
    expect(await synonymsOf(b)).not.toContain('owner-left');
    expect(db.select().from(soundSynonyms).where(eq(soundSynonyms.itemId, sound.id)).all()).toEqual([]);
  });

  it('when the user deletes their account removes their synonyms and categories', async () => {
    const leaver = await signUp(app);
    const sound = await addedSound(a, leaver, 'Stays');
    const own = await category(leaver, 'Leaver category');
    await patch(leaver, `/api/sounds/${sound.id}`, { synonyms: ['leaver-word'], categoryIds: [own.id] });
    const res = await call(app, leaver, 'DELETE', '/api/me', { email: leaver.email });
    expect(res.statusCode, res.body).toBe(204);
    expect(db.select().from(synonyms).where(eq(synonyms.ownerId, leaver.id)).all()).toEqual([]);
    expect(db.select().from(categories).where(eq(categories.ownerId, leaver.id)).all()).toEqual([]);
    expect((await soundOf(a, sound.id)).synonyms).toEqual([]);
  });
});

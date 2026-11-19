import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Category, Mix, Scene, Sound } from '@dnd/shared';
import { buildApp } from '../app.js';
import {
  call,
  createMix,
  createScene,
  expectError,
  signUp,
  uploadRaw,
  uploadSound,
  type TestUser,
} from '../test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

interface Seed {
  sound: Sound;
  mix: Mix;
  scene: Scene;
  category: Category;
}

async function seed(owner: TestUser): Promise<Seed> {
  const res = await call(app, owner, 'POST', '/api/categories', { name: 'Owned category', color: '#3b5b8c' });
  expect(res.statusCode, res.body).toBe(201);
  const category: Category = res.json();
  const sound = await uploadSound(app, owner, { fields: { name: 'Owned sound' } });
  const tagged = await call(app, owner, 'PATCH', `/api/sounds/${sound.id}`, {
    synonyms: ['owned synonym'],
    categoryIds: [category.id],
  });
  expect(tagged.statusCode, tagged.body).toBe(200);
  const mix = await createMix(app, owner, { name: 'Owned mix', items: [{ soundId: sound.id }] });
  const scene = await createScene(app, owner, {
    name: 'Owned scene',
    soundIds: [sound.id],
    mixIds: [mix.id],
  });
  return { sound: tagged.json(), mix, scene, category };
}

/** Everything user A owns, as the API reports it. */
async function snapshot(owner: TestUser) {
  const lists = await Promise.all(
    ['/api/sounds', '/api/mixes', '/api/scenes', '/api/me', '/api/categories', '/api/synonyms'].map((url) =>
      call(app, owner, 'GET', url).then((r) => r.json()),
    ),
  );
  return lists;
}

type Resource = 'sound' | 'mix' | 'scene' | 'category';

interface RouteCase {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Same notation as the registered route (`:id` for the resource id). */
  route: string;
  resource?: Resource;
  body?: unknown;
}

/** Every /api route that requires a session. The completeness test keeps this list honest. */
const PROTECTED: RouteCase[] = [
  { method: 'GET', route: '/api/me' },
  { method: 'PATCH', route: '/api/me', body: { name: 'Hijacked' } },
  { method: 'DELETE', route: '/api/me', body: { email: 'x@example.com' } },
  { method: 'POST', route: '/api/me/changelog-seen' },
  { method: 'GET', route: '/api/changelog/:locale' },
  { method: 'GET', route: '/api/sounds' },
  { method: 'POST', route: '/api/sounds' },
  { method: 'GET', route: '/api/sounds/:id', resource: 'sound' },
  { method: 'PATCH', route: '/api/sounds/:id', resource: 'sound', body: { name: 'Hijacked' } },
  { method: 'DELETE', route: '/api/sounds/:id', resource: 'sound' },
  { method: 'GET', route: '/api/sounds/:id/audio', resource: 'sound' },
  { method: 'PUT', route: '/api/sounds/:id/image', resource: 'sound' },
  { method: 'DELETE', route: '/api/sounds/:id/image', resource: 'sound' },
  { method: 'PUT', route: '/api/mixes/:id/image', resource: 'mix' },
  { method: 'DELETE', route: '/api/mixes/:id/image', resource: 'mix' },
  { method: 'PUT', route: '/api/scenes/:id/image', resource: 'scene' },
  { method: 'DELETE', route: '/api/scenes/:id/image', resource: 'scene' },
  { method: 'GET', route: '/api/images/:key' },
  { method: 'GET', route: '/api/images' },
  { method: 'GET', route: '/api/library' },
  { method: 'PUT', route: '/api/library/sounds/:id', resource: 'sound' },
  { method: 'DELETE', route: '/api/library/sounds/:id', resource: 'sound' },
  { method: 'PUT', route: '/api/library/mixes/:id', resource: 'mix' },
  { method: 'DELETE', route: '/api/library/mixes/:id', resource: 'mix' },
  { method: 'PUT', route: '/api/mixes/:id/volumes', resource: 'mix', body: { volumes: {} } },
  { method: 'GET', route: '/api/mixes' },
  { method: 'POST', route: '/api/mixes', body: { name: 'New' } },
  { method: 'GET', route: '/api/mixes/:id', resource: 'mix' },
  { method: 'PATCH', route: '/api/mixes/:id', resource: 'mix', body: { name: 'Hijacked' } },
  { method: 'DELETE', route: '/api/mixes/:id', resource: 'mix' },
  { method: 'GET', route: '/api/scenes' },
  { method: 'POST', route: '/api/scenes', body: { name: 'New' } },
  { method: 'PUT', route: '/api/scenes/order', body: { ids: [] } },
  { method: 'GET', route: '/api/scenes/:id', resource: 'scene' },
  { method: 'PATCH', route: '/api/scenes/:id', resource: 'scene', body: { name: 'Hijacked' } },
  { method: 'DELETE', route: '/api/scenes/:id', resource: 'scene' },
  { method: 'GET', route: '/api/synonyms' },
  { method: 'GET', route: '/api/categories' },
  { method: 'POST', route: '/api/categories', body: { name: 'New', color: '#3b5b8c' } },
  { method: 'PATCH', route: '/api/categories/:id', resource: 'category', body: { name: 'Hijacked' } },
  { method: 'DELETE', route: '/api/categories/:id', resource: 'category' },
  { method: 'POST', route: '/api/terms/accept' },
];

// Admin routes - they have their own test below since they need different resource handling
const ADMIN_ROUTES: RouteCase[] = [
  { method: 'GET', route: '/api/admin/settings' },
  { method: 'PUT', route: '/api/admin/settings/signups', body: { open: true } },
  { method: 'PUT', route: '/api/admin/settings/defaults', body: { limits: {} } },
  { method: 'GET', route: '/api/admin/settings/terms' },
  { method: 'PUT', route: '/api/admin/settings/terms', body: { enabled: true, rules: {} } },
  { method: 'POST', route: '/api/admin/settings/terms/preview', body: { locale: 'en', html: '' } },
  { method: 'GET', route: '/api/admin/users' },
  { method: 'PATCH', route: '/api/admin/users/:id/role', body: { role: 'user' } },
  { method: 'PATCH', route: '/api/admin/users/:id/banned', body: { banned: false } },
  { method: 'PATCH', route: '/api/admin/users/:id/limits', body: { overrides: {} } },
  { method: 'POST', route: '/api/admin/users/:id/reset-password' },
  { method: 'DELETE', route: '/api/admin/users/:id' },
  { method: 'GET', route: '/api/admin/usage' },
  { method: 'GET', route: '/api/admin/contact' },
  { method: 'PATCH', route: '/api/admin/contact/:id/read', body: { read: true } },
  { method: 'DELETE', route: '/api/admin/contact/:id' },
];

// The rules are read before anyone has an account, so the locale route is public. The
// contact form is public too: someone may write before creating an account, and the script
// that carries its settings is loaded by the page before anyone signs in.
const PUBLIC_ROUTES = [
  'GET /api/health',
  'GET /api/settings/public',
  'GET /api/settings/contact.js',
  'GET /api/terms/:locale',
  'POST /api/contact',
];

/** Parses `app.printRoutes()` (a radix tree) into "METHOD /full/path" entries. */
function registeredApiRoutes(): string[] {
  const stack: string[] = [];
  const found: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^((?:│ {3}| {4})*)(?:├── |└── )(\S+) \(([^)]+)\)$/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 4;
    stack[depth] = (stack[depth - 1] ?? '') + match[2];
    for (const method of match[3].split(', ')) {
      if (method !== 'HEAD' && stack[depth].startsWith('/api/')) found.push(`${method} ${stack[depth]}`);
    }
  }
  return found;
}

function urlFor(route: string, resource: Resource | undefined, seeded: Seed): string {
  return resource ? route.replace(':id', seeded[resource].id) : route;
}

describe('route inventory', () => {
  it('lists every registered /api route in this matrix', () => {
    const expected = [
      ...PROTECTED.map((c) => `${c.method} ${c.route}`),
      ...ADMIN_ROUTES.map((c) => `${c.method} ${c.route}`),
      ...PUBLIC_ROUTES,
    ].sort();
    expect(registeredApiRoutes().sort()).toEqual(expected);
  });
});

describe('signed-out caller', () => {
  it.each(PROTECTED.map((c) => [`${c.method} ${c.route}`, c] as const))(
    '%s is refused with 401',
    async (_name, c) => {
      const owner = await signUp(app);
      const seeded = await seed(owner);
      const res = await call(app, null, c.method, urlFor(c.route, c.resource, seeded), c.body);
      expectError(res, 401, 'unauthorized');
    },
  );

  it('refuses an upload without a session before reading it', async () => {
    expectError(await uploadRaw(app, null), 401, 'unauthorized');
  });

  it('refuses a garbage session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'better-auth.session_token=not-a-real-token' },
    });
    expectError(res, 401, 'unauthorized');
  });
});

describe('public routes', () => {
  it('serves health and public settings without a session', async () => {
    expect((await call(app, null, 'GET', '/api/health')).statusCode).toBe(200);
    const settings = await call(app, null, 'GET', '/api/settings/public');
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toEqual({ signupsOpen: true });
  });
});

describe('Better Auth admin routes', () => {
  it.each(['/api/auth/admin/list-users', '/api/auth/admin/set-role', '/api/auth/admin/ban-user'])(
    '%s is not exposed',
    async (url) => {
      const user = await signUp(app);
      for (const caller of [null, user]) {
        for (const method of ['GET', 'POST'] as const) {
          const res = await call(app, caller, method, url, method === 'POST' ? {} : undefined);
          expectError(res, 404, 'not_found');
        }
      }
    },
  );
});

describe('admin routes authorization', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await signUp(app);
    userB = await signUp(app);
  });

  // Admin routes require admin role - test that non-admin users get 403 Forbidden
  it.each(ADMIN_ROUTES.map((c) => [`${c.method} ${c.route}`, c] as const))(
    '%s requires admin role (403 for regular user)',
    async (_name, c) => {
      const res = await call(app, userB, c.method, c.route.replace(':id', userA.id), c.body);
      expectError(res, 403, 'forbidden');
    },
  );
});

describe('user B acting on user A resources', () => {
  let a: TestUser;
  let b: TestUser;
  let seeded: Seed;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
    seeded = await seed(a);
  });

  const withResource = PROTECTED.filter((c) => c.resource);
  it.each(withResource.map((c) => [`${c.method} ${c.route}`, c] as const))(
    '%s answers 404 and changes nothing',
    async (_name, c) => {
      const before = await snapshot(a);
      const res = await call(app, b, c.method, urlFor(c.route, c.resource, seeded), c.body);
      expectError(res, 404, 'not_found');
      expect(await snapshot(a)).toEqual(before);
    },
  );

  it('does not reveal a difference between foreign and missing ids', async () => {
    const foreign = await call(app, b, 'GET', `/api/sounds/${seeded.sound.id}`);
    const missing = await call(app, b, 'GET', '/api/sounds/does-not-exist');
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.json().error.code).toBe(missing.json().error.code);
  });

  it('never puts A rows in B lists', async () => {
    for (const url of ['/api/sounds', '/api/mixes', '/api/scenes']) {
      expect((await call(app, b, 'GET', url)).json(), url).toEqual([]);
    }
    const own = await seed(b);
    const sounds = (await call(app, b, 'GET', '/api/sounds')).json() as Sound[];
    const mixes = (await call(app, b, 'GET', '/api/mixes')).json() as Mix[];
    const scenes = (await call(app, b, 'GET', '/api/scenes')).json() as Scene[];
    expect(sounds.map((s) => s.id)).toEqual([own.sound.id]);
    expect(mixes.map((m) => m.id)).toEqual([own.mix.id]);
    expect(scenes.map((s) => s.id)).toEqual([own.scene.id]);
    expect(JSON.stringify([sounds, mixes, scenes])).not.toContain(seeded.sound.id);
    expect(JSON.stringify([sounds, mixes, scenes])).not.toContain(seeded.scene.id);
  });

  it('does not count A data in the usage of B', async () => {
    const me = (await call(app, await signUp(app), 'GET', '/api/me')).json();
    expect(me.usage).toEqual({ storageBytes: 0, sounds: 0, mixes: 0, scenes: 0 });
  });
});

describe('user B referencing A ids in a body', () => {
  let a: TestUser;
  let b: TestUser;
  let seededA: Seed;
  let seededB: Seed;
  beforeAll(async () => {
    a = await signUp(app);
    b = await signUp(app);
    seededA = await seed(a);
    seededB = await seed(b);
  });

  /** Runs a request as B, expects a validation error, and checks neither side changed. */
  async function expectRejected(res: Awaited<ReturnType<typeof call>>) {
    expectError(res, 400, 'validation');
  }

  async function unchanged(run: () => Promise<void>) {
    const beforeA = await snapshot(a);
    const beforeB = await snapshot(b);
    await run();
    expect(await snapshot(a)).toEqual(beforeA);
    expect(await snapshot(b)).toEqual(beforeB);
  }

  it('rejects A sound in a new mix of B', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'POST', '/api/mixes', {
          name: 'Stolen',
          items: [{ soundId: seededA.sound.id }],
        }),
      );
    });
  });

  it('rejects A sound next to an own sound in a mix', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'POST', '/api/mixes', {
          name: 'Mixed',
          items: [{ soundId: seededB.sound.id }, { soundId: seededA.sound.id }],
        }),
      );
    });
  });

  it('rejects A sound in the items of an existing mix of B', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'PATCH', `/api/mixes/${seededB.mix.id}`, {
          items: [{ soundId: seededA.sound.id }],
        }),
      );
    });
  });

  it('rejects A scene in sceneIds of a new or existing mix of B', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'POST', '/api/mixes', { name: 'X', sceneIds: [seededA.scene.id] }),
      );
      await expectRejected(
        await call(app, b, 'PATCH', `/api/mixes/${seededB.mix.id}`, {
          sceneIds: [seededA.scene.id],
        }),
      );
    });
  });

  it('rejects A scene in sceneIds of an upload or a PATCH of a sound of B', async () => {
    await unchanged(async () => {
      await expectRejected(
        await uploadRaw(app, b, { fields: { sceneIds: JSON.stringify([seededA.scene.id]) } }),
      );
      await expectRejected(
        await call(app, b, 'PATCH', `/api/sounds/${seededB.sound.id}`, {
          sceneIds: [seededA.scene.id],
        }),
      );
    });
  });

  it('rejects A sound or A mix in a scene of B', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'POST', '/api/scenes', { name: 'X', soundIds: [seededA.sound.id] }),
      );
      await expectRejected(
        await call(app, b, 'POST', '/api/scenes', { name: 'X', mixIds: [seededA.mix.id] }),
      );
      await expectRejected(
        await call(app, b, 'PATCH', `/api/scenes/${seededB.scene.id}`, {
          soundIds: [seededB.sound.id, seededA.sound.id],
        }),
      );
      await expectRejected(
        await call(app, b, 'PATCH', `/api/scenes/${seededB.scene.id}`, {
          mixIds: [seededA.mix.id],
        }),
      );
    });
  });

  it('rejects A categories in categoryIds of a sound, mix or scene of B', async () => {
    const theirs = [seededA.category.id];
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'PATCH', `/api/sounds/${seededB.sound.id}`, { categoryIds: theirs }),
      );
      await expectRejected(
        await call(app, b, 'PATCH', `/api/mixes/${seededB.mix.id}`, {
          categoryIds: [seededB.category.id, ...theirs],
        }),
      );
      await expectRejected(await call(app, b, 'POST', '/api/mixes', { name: 'X', categoryIds: theirs }));
      await expectRejected(
        await call(app, b, 'PATCH', `/api/scenes/${seededB.scene.id}`, { categoryIds: theirs }),
      );
      await expectRejected(await call(app, b, 'POST', '/api/scenes', { name: 'X', categoryIds: theirs }));
    });
  });

  it('rejects A scene ids in PUT /api/scenes/order', async () => {
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'PUT', '/api/scenes/order', { ids: [seededA.scene.id] }),
      );
      await expectRejected(
        await call(app, b, 'PUT', '/api/scenes/order', {
          ids: [seededB.scene.id, seededA.scene.id],
        }),
      );
    });
  });

  it('does not let a reorder of B move the scenes of A', async () => {
    const second = await createScene(app, a, { name: 'A second' });
    await unchanged(async () => {
      await expectRejected(
        await call(app, b, 'PUT', '/api/scenes/order', { ids: [second.id, seededA.scene.id] }),
      );
    });
  });
});

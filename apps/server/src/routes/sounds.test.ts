import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Sound } from '@dnd/shared';
import { buildApp } from '../app.js';
import { config } from '../config.js';
import {
  call,
  createMix,
  createScene,
  expectError,
  signUp,
  uploadRaw,
  uploadSound,
  wavFile,
} from '../test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

const tmpFiles = () => readdirSync(config.tmpDir);
const userFiles = (userId: string) => {
  const dir = join(config.audioDir, userId);
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe('upload', () => {
  it('derives the name from the file name', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user, { filename: 'Goblin_growl.v2.wav' });
    expect(sound.name).toBe('Goblin growl.v2');
  });

  it('falls back to a generic name when the file name gives nothing usable', async () => {
    const user = await signUp(app);
    expect((await uploadSound(app, user, { filename: '___.wav' })).name).toBe('Sound');
    const long = await uploadSound(app, user, { filename: `${'x'.repeat(150)}.wav` });
    expect(long.name).toHaveLength(100);
  });

  it('uses and trims an explicit name', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user, {
      filename: 'ignored.wav',
      fields: { name: '  Thunder  ' },
    });
    expect(sound.name).toBe('Thunder');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'n'.repeat(101)],
  ])('rejects an explicit name that is %s', async (_label, name) => {
    const user = await signUp(app);
    expectError(await uploadRaw(app, user, { fields: { name } }), 400, 'validation');
    expect(tmpFiles()).toEqual([]);
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toEqual([]);
  });

  it('defaults to one-shot up to 10 s and to loop above', async () => {
    const user = await signUp(app);
    const short = await uploadSound(app, user, { content: wavFile(1) });
    const edge = await uploadSound(app, user, { content: wavFile(10) });
    const long = await uploadSound(app, user, { content: wavFile(10.5) });
    expect([short.defaultMode, edge.defaultMode, long.defaultMode]).toEqual([
      'oneshot',
      'oneshot',
      'loop',
    ]);
  });

  it('honours an explicit default mode in both directions', async () => {
    const user = await signUp(app);
    const loop = await uploadSound(app, user, { fields: { defaultMode: 'loop' } });
    const oneshot = await uploadSound(app, user, {
      content: wavFile(12),
      fields: { defaultMode: 'oneshot' },
    });
    const recurring = await uploadSound(app, user, { fields: { defaultMode: 'recurring' } });
    expect([loop.defaultMode, oneshot.defaultMode, recurring.defaultMode]).toEqual([
      'loop',
      'oneshot',
      'recurring',
    ]);
  });

  it('rejects an unknown default mode', async () => {
    const user = await signUp(app);
    expectError(
      await uploadRaw(app, user, { fields: { defaultMode: 'pulse' } }),
      400,
      'validation',
    );
    expect(tmpFiles()).toEqual([]);
  });

  it('applies the sceneIds field (JSON) and rejects malformed values', async () => {
    const user = await signUp(app);
    const s1 = await createScene(app, user, { name: 'One' });
    const s2 = await createScene(app, user, { name: 'Two' });
    const sound = await uploadSound(app, user, {
      fields: { sceneIds: JSON.stringify([s1.id, s2.id]) },
    });
    expect([...sound.sceneIds].sort()).toEqual([s1.id, s2.id].sort());
    expect((await call(app, user, 'GET', `/api/scenes/${s2.id}`)).json().soundIds).toEqual([
      sound.id,
    ]);

    for (const sceneIds of ['not json', '{"a":1}', '"abc"', JSON.stringify([1])]) {
      expectError(await uploadRaw(app, user, { fields: { sceneIds } }), 400, 'validation');
    }
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toHaveLength(1);
    expect(tmpFiles()).toEqual([]);
  });

  it('measures the duration and size from the file, not from the client', async () => {
    const user = await signUp(app);
    const content = wavFile(2.5);
    const sound = await uploadSound(app, user, {
      content,
      fields: { durationSec: '999', sizeBytes: '1', mimeType: 'audio/ogg' },
    });
    expect(sound.durationSec).toBeCloseTo(2.5, 2);
    expect(sound.sizeBytes).toBe(content.length);
    expect(sound.mimeType).toBe('audio/wav');
  });

  it('returns the documented shape for a fresh sound', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    expect(sound).toMatchObject({
      defaultVolume: 0.8,
      loopStartSec: null,
      loopEndSec: null,
      intervalMinSec: 20,
      intervalMaxSec: 90,
      volumeVariation: 0,
      illustration: { type: 'none' },
      sceneIds: [],
      audioUrl: `/api/sounds/${sound.id}/audio`,
    });
    expect((await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json()).toEqual(sound);
  });

  it('rejects text declared as audio with 415 and leaves nothing behind', async () => {
    const user = await signUp(app);
    const res = await uploadRaw(app, user, {
      filename: 'fake.wav',
      contentType: 'audio/wav',
      content: Buffer.from('This is plainly a text file, not audio at all.'),
    });
    expectError(res, 415, 'unsupported_type');
    expect(tmpFiles()).toEqual([]);
    expect(userFiles(user.id)).toEqual([]);
    expect((await call(app, user, 'GET', '/api/sounds')).json()).toEqual([]);
  });

  it('rejects an image and a bare audio header declared as audio', async () => {
    const user = await signUp(app);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(200),
    ]);
    expectError(
      await uploadRaw(app, user, { filename: 'a.mp3', contentType: 'audio/mpeg', content: png }),
      415,
      'unsupported_type',
    );
    // Passes the signature check but holds no audio data.
    const headerOnly = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.alloc(8)]);
    expectError(
      await uploadRaw(app, user, { filename: 'b.wav', content: headerOnly }),
      415,
      'unsupported_type',
    );
    expect(tmpFiles()).toEqual([]);
    expect(userFiles(user.id)).toEqual([]);
  });

  it('rejects an empty file with 400', async () => {
    const user = await signUp(app);
    const res = await uploadRaw(app, user, { content: Buffer.alloc(0) });
    expectError(res, 400, 'validation');
    expect(tmpFiles()).toEqual([]);
  });

  it('accepts valid WAV content whatever type the client declares', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user, {
      filename: 'noext',
      contentType: 'application/octet-stream',
    });
    expect(sound.mimeType).toBe('audio/wav');
    const wrongName = await uploadSound(app, user, {
      filename: 'sound.png',
      contentType: 'image/png',
    });
    expect(wrongName.mimeType).toBe('audio/wav');
  });

  it('rejects a request without a file part', async () => {
    const user = await signUp(app);
    const boundary = '----nofile';
    const res = await app.inject({
      method: 'POST',
      url: '/api/sounds',
      headers: {
        cookie: user.cookie,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nX\r\n--${boundary}--\r\n`,
    });
    expectError(res, 400, 'validation');
    expect(tmpFiles()).toEqual([]);
  });

  it('rejects a body that is not multipart', async () => {
    const user = await signUp(app);
    expectError(await call(app, user, 'POST', '/api/sounds', { name: 'x' }), 400, 'validation');
  });

  it('leaves the temp folder empty after a successful upload', async () => {
    const user = await signUp(app);
    await uploadSound(app, user);
    await uploadSound(app, user, { content: wavFile(3) });
    expect(tmpFiles()).toEqual([]);
    expect(userFiles(user.id)).toHaveLength(2);
  });

  it('stores files only under the owner folder with a generated name', async () => {
    const user = await signUp(app);
    await uploadSound(app, user, { filename: '../../evil.wav' });
    const [file] = userFiles(user.id);
    expect(file).toMatch(/^[0-9a-f-]{36}\.wav$/);
  });
});

describe('listing and reading', () => {
  it('lists sounds sorted by name', async () => {
    const user = await signUp(app);
    for (const name of ['Charlie', 'Alpha', 'Bravo']) {
      await uploadSound(app, user, { fields: { name } });
    }
    const list = (await call(app, user, 'GET', '/api/sounds')).json() as Sound[];
    expect(list.map((s) => s.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('answers 404 for an id that does not exist', async () => {
    const user = await signUp(app);
    expectError(await call(app, user, 'GET', '/api/sounds/nope'), 404, 'not_found');
  });
});

describe('PATCH validation', () => {
  async function patch(sound: Sound, user: Awaited<ReturnType<typeof signUp>>, body: unknown) {
    return call(app, user, 'PATCH', `/api/sounds/${sound.id}`, body);
  }

  async function fixture(seconds = 12) {
    const user = await signUp(app);
    const sound = await uploadSound(app, user, { content: wavFile(seconds) });
    return { user, sound };
  }

  it('accepts both loop points, then clears them', async () => {
    const { user, sound } = await fixture();
    const set = await patch(sound, user, { loopStartSec: 1.5, loopEndSec: 10 });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json()).toMatchObject({ loopStartSec: 1.5, loopEndSec: 10 });
    const cleared = await patch(sound, user, { loopStartSec: null, loopEndSec: null });
    expect(cleared.json()).toMatchObject({ loopStartSec: null, loopEndSec: null });
  });

  it('accepts a loop end equal to the duration', async () => {
    const { user, sound } = await fixture();
    expect((await patch(sound, user, { loopStartSec: 0, loopEndSec: 12 })).statusCode).toBe(200);
  });

  it('requires both loop points or neither', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, { loopStartSec: 1 }), 400, 'validation');
    expectError(await patch(sound, user, { loopEndSec: 5 }), 400, 'validation');

    await patch(sound, user, { loopStartSec: 1, loopEndSec: 5 });
    expectError(await patch(sound, user, { loopStartSec: null }), 400, 'validation');
    expectError(await patch(sound, user, { loopEndSec: null }), 400, 'validation');
    const after = (await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json();
    expect(after).toMatchObject({ loopStartSec: 1, loopEndSec: 5 });
  });

  it('requires the loop start to be before the end', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, { loopStartSec: 5, loopEndSec: 2 }), 400, 'validation');
    expectError(await patch(sound, user, { loopStartSec: 3, loopEndSec: 3 }), 400, 'validation');
    await patch(sound, user, { loopStartSec: 1, loopEndSec: 5 });
    // Checked against the stored counterpart too.
    expectError(await patch(sound, user, { loopStartSec: 6 }), 400, 'validation');
    expectError(await patch(sound, user, { loopEndSec: 0.5 }), 400, 'validation');
  });

  it('rejects a loop end past the duration and negative points', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, { loopStartSec: 1, loopEndSec: 13 }), 400, 'validation');
    expectError(await patch(sound, user, { loopStartSec: -1, loopEndSec: 5 }), 400, 'validation');
  });

  it('rejects an interval minimum above the maximum', async () => {
    const { user, sound } = await fixture();
    expectError(
      await patch(sound, user, { intervalMinSec: 30, intervalMaxSec: 10 }),
      400,
      'validation',
    );
    // Stored maximum is 90, stored minimum is 20.
    expectError(await patch(sound, user, { intervalMinSec: 100 }), 400, 'validation');
    expectError(await patch(sound, user, { intervalMaxSec: 10 }), 400, 'validation');
    expect((await patch(sound, user, { intervalMinSec: 5, intervalMaxSec: 5 })).statusCode).toBe(
      200,
    );
  });

  it('keeps recurring waits within 1 to 3600 s', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, { intervalMinSec: 0.5 }), 400, 'validation');
    expectError(await patch(sound, user, { intervalMaxSec: 3601 }), 400, 'validation');
  });

  it('keeps volume within 0 to 1', async () => {
    const { user, sound } = await fixture();
    for (const defaultVolume of [-0.1, 1.1, '0.5', null]) {
      expectError(await patch(sound, user, { defaultVolume }), 400, 'validation');
    }
    for (const defaultVolume of [0, 1]) {
      const res = await patch(sound, user, { defaultVolume });
      expect(res.json().defaultVolume).toBe(defaultVolume);
    }
    expectError(await patch(sound, user, { volumeVariation: 2 }), 400, 'validation');
  });

  it('rejects unknown and server-owned fields', async () => {
    const { user, sound } = await fixture();
    for (const body of [
      { foo: 1 },
      { durationSec: 3 },
      { sizeBytes: 1 },
      { id: 'x' },
      { ownerId: 'x' },
      { fileKey: 'x' },
      { audioUrl: '/x' },
      { kind: 'sfx' },
    ]) {
      expectError(await patch(sound, user, body), 400, 'validation');
    }
    const after = (await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json();
    expect(after).toEqual(sound);
  });

  it('trims names and enforces 1 to 100 characters', async () => {
    const { user, sound } = await fixture();
    expect((await patch(sound, user, { name: '  Bell  ' })).json().name).toBe('Bell');
    expect((await patch(sound, user, { name: 'n'.repeat(100) })).statusCode).toBe(200);
    expectError(await patch(sound, user, { name: '' }), 400, 'validation');
    expectError(await patch(sound, user, { name: '   ' }), 400, 'validation');
    expectError(await patch(sound, user, { name: 'n'.repeat(101) }), 400, 'validation');
    expectError(await patch(sound, user, { name: 'bad\u0007name' }), 400, 'validation');
  });

  it('changes the default mode and bumps updatedAt', async () => {
    const { user, sound } = await fixture();
    await new Promise((r) => setTimeout(r, 5));
    const res = await patch(sound, user, { defaultMode: 'recurring' });
    expect(res.json().defaultMode).toBe('recurring');
    expect(res.json().updatedAt > sound.updatedAt).toBe(true);
  });

  it('rejects a non-object body', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, [1, 2]), 400, 'validation');
    expectError(await patch(sound, user, 5), 400, 'validation');
  });

  it('replaces the scene membership with sceneIds', async () => {
    const { user, sound } = await fixture();
    const s1 = await createScene(app, user, { name: 'One' });
    const s2 = await createScene(app, user, { name: 'Two' });

    const first = await patch(sound, user, { sceneIds: [s1.id] });
    expect(first.json().sceneIds).toEqual([s1.id]);
    const second = await patch(sound, user, { sceneIds: [s2.id] });
    expect(second.json().sceneIds).toEqual([s2.id]);
    expect((await call(app, user, 'GET', `/api/scenes/${s1.id}`)).json().soundIds).toEqual([]);
    expect((await call(app, user, 'GET', `/api/scenes/${s2.id}`)).json().soundIds).toEqual([
      sound.id,
    ]);

    // Leaving sceneIds out keeps the membership.
    expect((await patch(sound, user, { name: 'Renamed' })).json().sceneIds).toEqual([s2.id]);
    expect((await patch(sound, user, { sceneIds: [] })).json().sceneIds).toEqual([]);
  });

  it('rejects a nonexistent scene id without changing the sound', async () => {
    const { user, sound } = await fixture();
    expectError(await patch(sound, user, { sceneIds: ['nope'] }), 400, 'validation');
    expectError(await patch(sound, user, { name: 'Changed', sceneIds: ['nope'] }), 400, 'validation');
    expect((await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json().name).toBe(sound.name);
  });
});

describe('DELETE', () => {
  it('removes the row, the file on disk and the stored bytes', async () => {
    const user = await signUp(app);
    const keep = await uploadSound(app, user);
    const doomed = await uploadSound(app, user, { content: wavFile(2) });
    expect(userFiles(user.id)).toHaveLength(2);

    const res = await call(app, user, 'DELETE', `/api/sounds/${doomed.id}`);
    expect(res.statusCode).toBe(204);
    expect(userFiles(user.id)).toHaveLength(1);
    expectError(await call(app, user, 'GET', `/api/sounds/${doomed.id}`), 404, 'not_found');
    expectError(await call(app, user, 'GET', doomed.audioUrl), 404, 'not_found');
    expectError(await call(app, user, 'DELETE', `/api/sounds/${doomed.id}`), 404, 'not_found');

    const me = (await call(app, user, 'GET', '/api/me')).json();
    expect(me.usage).toMatchObject({ sounds: 1, storageBytes: keep.sizeBytes });
  });

  it('removes the sound from the mixes that used it and keeps the rest in order', async () => {
    const user = await signUp(app);
    const a = await uploadSound(app, user, { fields: { name: 'A' } });
    const b = await uploadSound(app, user, { fields: { name: 'B' } });
    const c = await uploadSound(app, user, { fields: { name: 'C' } });
    const mix = await createMix(app, user, {
      name: 'M',
      items: [{ soundId: a.id }, { soundId: b.id }, { soundId: c.id }],
    });
    const other = await createMix(app, user, { name: 'Other', items: [{ soundId: b.id }] });

    await call(app, user, 'DELETE', `/api/sounds/${b.id}`);

    const after = (await call(app, user, 'GET', `/api/mixes/${mix.id}`)).json();
    expect(after.items.map((i: { soundId: string }) => i.soundId)).toEqual([a.id, c.id]);
    expect((await call(app, user, 'GET', `/api/mixes/${other.id}`)).json().items).toEqual([]);
  });
});

describe('audio route', () => {
  it('sends the whole file with private caching', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    const sound = await uploadSound(app, user, { content });
    const res = await call(app, user, 'GET', sound.audioUrl);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toMatch(/^private/);
    expect(res.headers['cache-control']).not.toContain('public');
    expect(res.headers['content-type']).toContain('audio/wav');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.rawPayload.equals(content)).toBe(true);
  });

  it('supports byte ranges with 206', async () => {
    const user = await signUp(app);
    const content = wavFile(1);
    const sound = await uploadSound(app, user, { content });
    const get = (range: string) =>
      app.inject({
        method: 'GET',
        url: sound.audioUrl,
        headers: { cookie: user.cookie, range },
      });

    const head = await get('bytes=0-43');
    expect(head.statusCode).toBe(206);
    expect(head.headers['content-range']).toBe(`bytes 0-43/${content.length}`);
    expect(head.headers['cache-control']).toMatch(/^private/);
    expect(head.rawPayload.equals(content.subarray(0, 44))).toBe(true);

    const tail = await get('bytes=-10');
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(content.subarray(content.length - 10))).toBe(true);

    const open = await get('bytes=100-');
    expect(open.statusCode).toBe(206);
    expect(open.rawPayload.length).toBe(content.length - 100);
  });

  it('answers a range past the end with 416', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const res = await app.inject({
      method: 'GET',
      url: sound.audioUrl,
      headers: { cookie: user.cookie, range: 'bytes=99999999-' },
    });
    expect(res.statusCode).toBe(416);
  });
});

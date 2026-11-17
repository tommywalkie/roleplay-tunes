import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { buildApp } from '../app.js';
import {
  call,
  expectError,
  multipart,
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

/** A real 1024x640 PNG, built with sharp so the re-encode has genuine pixels to crop. */
async function pngFile(): Promise<Buffer> {
  return sharp({
    create: { width: 1024, height: 640, channels: 3, background: { r: 24, g: 96, b: 160 } },
  })
    .png()
    .toBuffer();
}

/** PUTs a file part against a sound's image route. */
function uploadImage(user: TestUser, soundId: string, content: Buffer, contentType = 'image/png') {
  const body = multipart({}, { filename: 'cover', contentType, content });
  return app.inject({
    method: 'PUT',
    url: `/api/sounds/${soundId}/image`,
    payload: body.payload,
    headers: { ...body.headers, cookie: user.cookie },
  });
}

/** Uploads the fixture PNG and returns the client-visible image URL. */
async function uploadPng(user: TestUser, soundId: string): Promise<string> {
  const res = await uploadImage(user, soundId, await pngFile());
  expect(res.statusCode, res.body).toBe(204);
  const sound = (await call(app, user, 'GET', `/api/sounds/${soundId}`)).json();
  expect(sound.illustration.type).toBe('image');
  return sound.illustration.url as string;
}

describe('sound images', () => {
  it('re-encodes an uploaded PNG to a 512px square WebP and serves it to its owner', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    const url = await uploadPng(user, sound.id);

    // The stored key is a bare uuid: /api/images/<key>, one path segment.
    expect(url.startsWith('/api/images/')).toBe(true);
    expect(url.slice('/api/images/'.length)).toMatch(/^[0-9a-f-]{36}$/);

    const img = await app.inject({
      method: 'GET',
      url,
      headers: { cookie: user.cookie },
    });
    expect(img.statusCode, img.body).toBe(200);
    expect(img.headers['content-type']).toContain('image/webp');
    expect(String(img.headers['cache-control'])).toMatch(/^private/);

    const meta = await sharp(img.rawPayload).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width, 'the stored square is 512 px wide').toBe(512);
    expect(meta.height, 'the stored square is 512 px tall').toBe(512);
    expect(meta.exif, 'metadata is stripped').toBeUndefined();
  });

  it('rejects an upload that is not a JPEG, PNG or WebP image', async () => {
    const user = await signUp(app);
    const sound = await uploadSound(app, user);
    expectError(
      await uploadImage(user, sound.id, wavFile(1), 'audio/wav'),
      415,
      'unsupported_type',
    );
    // The sound keeps its non-image illustration.
    const after = (await call(app, user, 'GET', `/api/sounds/${sound.id}`)).json();
    expect(after.illustration.type).toBe('none');
  });

  it('serves an image only to its owner', async () => {
    const owner = await signUp(app);
    const sound = await uploadSound(app, owner);
    const url = await uploadPng(owner, sound.id);

    const other = await signUp(app);
    expectError(await call(app, other, 'GET', url), 404, 'not_found');
    expect((await call(app, owner, 'GET', url)).statusCode).toBe(200);
  });
});

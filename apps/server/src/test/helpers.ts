/** Helpers shared by the API test files. */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { expect } from 'vitest';
import type { Mix, Scene, Sound } from '@dnd/shared';

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/** `name=value` pairs from Set-Cookie headers, ready for a Cookie request header. */
export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(';')[0]).join('; ');
}

export async function signUp(
  app: FastifyInstance,
  email = `user-${randomUUID()}@example.com`,
  password = 'password123',
): Promise<TestUser> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password, name: 'Test User' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { id: res.json().user.id, email, cookie: cookieHeader(res.headers['set-cookie']) };
}

/** Sends a request as a user (or signed out when `user` is null). */
export function call(
  app: FastifyInstance,
  user: TestUser | null,
  method: InjectOptions['method'],
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: user ? { cookie: user.cookie } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

/** Asserts an API error response: status and stable error code. */
export function expectError(
  res: { statusCode: number; body: string; json: () => { error?: { code?: string } } },
  status: number,
  code: string,
) {
  expect(res.statusCode, res.body).toBe(status);
  expect(res.json().error?.code, res.body).toBe(code);
}

/** A valid 16-bit mono PCM WAV file of the given duration (silence). */
export function wavFile(durationSec = 1, sampleRate = 8000): Buffer {
  const dataBytes = Math.round(durationSec * sampleRate) * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.alloc(dataBytes)]);
}

/** Builds a multipart/form-data body: text fields first, then the file part. */
export function multipart(
  fields: Record<string, string>,
  file: { filename: string; contentType: string; content: Buffer },
) {
  const boundary = `----test${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export function uploadRaw(
  app: FastifyInstance,
  user: TestUser | null,
  options: {
    fields?: Record<string, string>;
    filename?: string;
    contentType?: string;
    content?: Buffer;
  } = {},
) {
  const body = multipart(options.fields ?? {}, {
    filename: options.filename ?? 'sound.wav',
    contentType: options.contentType ?? 'audio/wav',
    content: options.content ?? wavFile(),
  });
  return app.inject({
    method: 'POST',
    url: '/api/sounds',
    payload: body.payload,
    headers: { ...body.headers, ...(user ? { cookie: user.cookie } : {}) },
  });
}

export async function uploadSound(
  app: FastifyInstance,
  user: TestUser,
  options: Parameters<typeof uploadRaw>[2] = {},
): Promise<Sound> {
  const res = await uploadRaw(app, user, options);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

export async function createMix(
  app: FastifyInstance,
  user: TestUser,
  body: Record<string, unknown> = { name: 'Mix' },
): Promise<Mix> {
  const res = await call(app, user, 'POST', '/api/mixes', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

export async function createScene(
  app: FastifyInstance,
  user: TestUser,
  body: Record<string, unknown> = { name: 'Scene' },
): Promise<Scene> {
  const res = await call(app, user, 'POST', '/api/scenes', body);
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

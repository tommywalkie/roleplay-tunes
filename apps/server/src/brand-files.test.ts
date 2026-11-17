import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: FastifyInstance;

beforeAll(async () => {
  const web = join(process.env.DATA_DIR!, 'web');
  mkdirSync(web, { recursive: true });
  writeFileSync(
    join(web, 'index.html'),
    '<!doctype html><title>app</title><meta property="og:image" content="__PUBLIC_URL__/og-image.png" />',
  );
  writeFileSync(join(web, 'manifest.webmanifest'), '{"name":"app"}');
  writeFileSync(join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  process.env.WEB_DIST = web;
  const { buildApp } = await import('./app.js');
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  delete process.env.WEB_DIST;
});

describe('brand files', () => {
  it('can be shown and fetched by any site', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/favicon.svg',
      headers: { origin: 'https://home.example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('shares the web app manifest too', async () => {
    const res = await app.inject({ method: 'GET', url: '/manifest.webmanifest' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('leaves the other files same-origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/index.html' });
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('index page', () => {
  it.each(['/', '/index.html', '/scenes/abc'])(
    '%s carries absolute addresses from PUBLIC_URL',
    async (url) => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.body).toContain('content="http://localhost:3000/og-image.png"');
      expect(res.body).not.toContain('__PUBLIC_URL__');
    },
  );
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { call, createMix, createScene, signUp, uploadSound, wavFile } from './test/helpers.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

describe('smoke', () => {
  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('sends security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });

  it('answers unknown routes with a structured 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('not_found');
  });

  it('runs the main flow: sign up, upload, mix, scene', async () => {
    const user = await signUp(app);

    const me = await call(app, user, 'GET', '/api/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: user.email, role: 'user', usage: { sounds: 0 } });

    const loop = await uploadSound(app, user, { filename: 'Tavern_crowd.wav', content: wavFile(12) });
    expect(loop).toMatchObject({ name: 'Tavern crowd', defaultMode: 'loop', mimeType: 'audio/wav' });
    expect(loop.durationSec).toBeCloseTo(12, 1);
    const door = await uploadSound(app, user, { fields: { name: 'Door' } });
    expect(door.defaultMode).toBe('oneshot');

    const mix = await createMix(app, user, {
      name: 'Tavern',
      items: [{ soundId: loop.id }, { soundId: door.id, mode: 'recurring', intervalMinSec: 5, intervalMaxSec: 9 }],
    });
    expect(mix.items.map((i) => [i.soundId, i.mode])).toEqual([
      [loop.id, 'loop'],
      [door.id, 'recurring'],
    ]);

    const scene = await createScene(app, user, { name: 'Inn', soundIds: [door.id], mixIds: [mix.id] });
    expect(scene).toMatchObject({ position: 0, soundIds: [door.id], mixIds: [mix.id] });

    const sounds = await call(app, user, 'GET', '/api/sounds');
    expect(sounds.json().find((s: { id: string }) => s.id === door.id).sceneIds).toEqual([scene.id]);

    const audio = await app.inject({
      method: 'GET',
      url: loop.audioUrl,
      headers: { cookie: user.cookie, range: 'bytes=0-99' },
    });
    expect(audio.statusCode).toBe(206);
    expect(audio.headers['cache-control']).toContain('private');
    expect(audio.rawPayload.length).toBe(100);
  });
});

// Must run before anything from the server is imported: config is read at import time.
process.env.RATE_LIMIT = 'true';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { call, signUp, type TestUser } from './test/helpers.js';

let app: FastifyInstance;
let user: TestUser;
beforeAll(async () => {
  const { buildApp } = await import('./app.js');
  app = await buildApp();
  user = await signUp(app); // counts as the first of the 5 allowed sign-ups
});
afterAll(async () => {
  await app.close();
});

const signIn = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password } });

describe('rate limits', () => {
  it('refuses the sixth sign-up from one address within an hour', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        payload: { email: `rl-${i}-${Date.now()}@example.com`, password: 'password123', name: 'R' },
      });
      statuses.push(res.statusCode);
    }
    // Four more succeed (five in total with the one in beforeAll), the next is refused.
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
  });

  it('refuses the 11th sign-in attempt within 10 minutes', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await signIn(user.email, 'wrong-password')).statusCode);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it('keeps refusing, even with the right password, while the window is full', async () => {
    const res = await signIn(user.email, 'password123');
    expect(res.statusCode).toBe(429);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('does not limit ordinary API calls at this scale', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await call(app, user, 'GET', '/api/health')).statusCode).toBe(200);
    }
  });
});

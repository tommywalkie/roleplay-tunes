import { afterEach, describe, expect, it, vi } from 'vitest';
import { illustrationChanges } from '../components/IllustrationField';
import { storageRatio } from '../components/StorageMeter';
import { createI18n, formatBytes, formatDuration } from '../i18n';
import { en } from '../i18n/en';
import { fr } from '../i18n/fr';
import { makeMe } from '../test/fixtures';
import { api, ApiError } from './client';

const respond = (status: number, body?: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      body === undefined
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('returns parsed JSON and sends JSON bodies with the session cookie', async () => {
    respond(200, { id: 'a' });
    await expect(api('/api/mixes', { method: 'POST', json: { name: 'x' } })).resolves.toEqual({ id: 'a' });
    expect(fetch).toHaveBeenCalledWith('/api/mixes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"x"}',
    });
  });

  it('resolves to undefined on 204', async () => {
    respond(204);
    await expect(api('/api/sounds/a', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('reads the API error shape with field messages', async () => {
    respond(400, { error: { code: 'quota_exceeded', message: 'Storage limit reached', fields: { name: 'bad' } } });
    const error = await api('/api/sounds').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'quota_exceeded', fields: { name: 'bad' } });
  });

  it('reads the auth error shape', async () => {
    respond(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' });
    await expect(api('/api/auth/sign-in/email', { method: 'POST', json: {} })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    respond(403, { code: 'signups_closed', message: 'Sign-ups are closed' });
    await expect(api('/api/auth/sign-up/email', { method: 'POST', json: {} })).rejects.toMatchObject({
      code: 'signups_closed',
    });
  });

  it('falls back to the status when the body says nothing', async () => {
    respond(413);
    await expect(api('/api/sounds', { method: 'POST' })).rejects.toMatchObject({ code: 'file_too_large' });
    respond(502);
    await expect(api('/api/sounds')).rejects.toMatchObject({ code: 'internal' });
  });

  it('reports an unreachable server as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed'))));
    await expect(api('/api/me')).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});

describe('i18n', () => {
  it('has the same keys in both languages, none empty', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    for (const text of [...Object.values(en), ...Object.values(fr)]) expect(text).not.toBe('');
  });

  it('picks plural forms per language', () => {
    const e = createI18n('en');
    const f = createI18n('fr');
    expect([e.tn('count.sounds', 0), e.tn('count.sounds', 1), e.tn('count.sounds', 2)]).toEqual([
      '0 sounds',
      '1 sound',
      '2 sounds',
    ]);
    expect([f.tn('count.sounds', 0), f.tn('count.sounds', 1), f.tn('count.sounds', 2)]).toEqual([
      '0 son',
      '1 son',
      '2 sons',
    ]);
  });

  it('translates every API error code and unknown errors', () => {
    const { errorText } = createI18n('en');
    expect(errorText(new ApiError(400, 'quota_exceeded', ''))).toBe('Your storage is full');
    expect(errorText(new Error('boom'))).toBe('The server ran into a problem');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(500 * 1024 * 1024, 'en')).toBe('500 MB');
    expect(formatBytes(1536, 'fr')).toBe('1,5 Ko');
    expect(formatDuration(7)).toBe('0:07');
    expect(formatDuration(200)).toBe('3:20');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('storageRatio', () => {
  it('is the share of the limit in use, capped at full', () => {
    expect(storageRatio(makeMe())).toBe(0.25);
    const limits = makeMe().limits;
    expect(storageRatio({ limits, usage: { ...makeMe().usage, storageBytes: limits.storageBytes * 2 } })).toBe(1);
    expect(storageRatio({ limits: { ...limits, storageBytes: 0 }, usage: makeMe().usage })).toBe(1);
  });
});

describe('illustrationChanges', () => {
  const file = new File(['x'], 'a.png', { type: 'image/png' });
  const icon = { type: 'icon', iconId: 'tabler:door', svg: '<svg/>' } as const;

  it('sends nothing when the illustration is unchanged', () => {
    expect(illustrationChanges({ type: 'none' }, { type: 'none' })).toEqual({});
    expect(illustrationChanges(icon, icon)).toEqual({});
    const image = { type: 'image', url: '/api/images/k' } as const;
    expect(illustrationChanges(image, image)).toEqual({});
  });

  it('sends an icon by id only, never its markup', () => {
    expect(illustrationChanges(icon, { type: 'none' })).toEqual({
      illustration: { type: 'icon', iconId: 'tabler:door' },
    });
  });

  it('sends a picked image as a file upload, outside the JSON body', () => {
    expect(illustrationChanges({ type: 'file', file, url: 'blob:x' }, icon)).toEqual({ image: file });
  });

  it('clears an existing illustration', () => {
    expect(illustrationChanges({ type: 'none' }, { type: 'image', url: '/api/images/k' })).toEqual({
      illustration: { type: 'none' },
    });
  });
});

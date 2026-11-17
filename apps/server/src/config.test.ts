import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const SECRET = 's'.repeat(32);
const production = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  AUTH_SECRET: SECRET,
  ...extra,
});

describe('loadConfig', () => {
  describe('production', () => {
    it('refuses to start without AUTH_SECRET', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
      expect(() => loadConfig({ NODE_ENV: 'production', AUTH_SECRET: '' })).toThrow(/AUTH_SECRET/);
    });

    it('refuses a secret shorter than 32 characters', () => {
      expect(() => loadConfig(production({ AUTH_SECRET: 's'.repeat(31) }))).toThrow(/AUTH_SECRET/);
    });

    it('accepts a secret of 32 characters', () => {
      const config = loadConfig(production());
      expect(config.authSecret).toBe(SECRET);
      expect(config.isProduction).toBe(true);
    });

    it('refuses the development secret', () => {
      const devSecret = loadConfig({}).authSecret;
      expect(() => loadConfig(production({ AUTH_SECRET: devSecret }))).toThrow(/AUTH_SECRET/);
    });

    it('turns rate limiting on unless disabled explicitly', () => {
      expect(loadConfig(production()).rateLimit).toBe(true);
      expect(loadConfig(production({ RATE_LIMIT: 'false' })).rateLimit).toBe(false);
    });

    it('logs at info level and keeps the database in the data directory', () => {
      const config = loadConfig(production({ DATA_DIR: './somewhere' }));
      expect(config.logLevel).toBe('info');
      expect(config.databasePath).toBe(resolve('./somewhere', 'app.db'));
    });
  });

  describe('invalid values', () => {
    it.each(['abc', '0', '70000', '-1', '3000.5', ''])('rejects PORT=%j', (PORT) => {
      expect(() => loadConfig({ PORT })).toThrow(/PORT/);
    });

    it('accepts the port bounds', () => {
      expect(loadConfig({ PORT: '1' }).port).toBe(1);
      expect(loadConfig({ PORT: '65535' }).port).toBe(65535);
    });

    it('rejects an unknown NODE_ENV, boolean, log level, URL and admin email', () => {
      expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
      expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
      expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
      expect(() => loadConfig({ PUBLIC_URL: 'not a url' })).toThrow(/PUBLIC_URL/);
      expect(() => loadConfig({ ADMIN_EMAIL: 'not-an-email' })).toThrow(/ADMIN_EMAIL/);
    });

    it('reports every invalid setting at once', () => {
      expect(() => loadConfig({ PORT: 'x', TRUST_PROXY: 'maybe' })).toThrow(
        /PORT[\s\S]*TRUST_PROXY/,
      );
    });
  });

  describe('development defaults', () => {
    const config = loadConfig({});

    it('uses the documented defaults', () => {
      expect(config).toMatchObject({
        env: 'development',
        isProduction: false,
        isTest: false,
        host: '0.0.0.0',
        port: 3000,
        publicUrl: 'http://localhost:3000',
        trustedOrigins: ['http://localhost:5173'],
        adminEmail: 'admin@roleplay-tunes.local',
        webDist: undefined,
        trustProxy: false,
        rateLimit: true,
        logLevel: 'info',
      });
    });

    it('lays the data directory out as audio, images, tmp and app.db', () => {
      // The development default is the team's shared dev database (see DATA_DIR in config.ts).
      const dir = resolve('../../tmp/dev-data');
      expect(config.dataDir).toBe(dir);
      expect(config.audioDir).toBe(resolve(dir, 'audio'));
      expect(config.imageDir).toBe(resolve(dir, 'images'));
      expect(config.tmpDir).toBe(resolve(dir, 'tmp'));
      expect(config.databasePath).toBe(resolve(dir, 'app.db'));
    });

    it('uses a development secret that is long enough for production rules', () => {
      expect(config.authSecret.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('test environment', () => {
    it('uses an in-memory database, is silent and keeps rate limiting off by default', () => {
      const config = loadConfig({ NODE_ENV: 'test' });
      expect(config).toMatchObject({
        isTest: true,
        databasePath: ':memory:',
        rateLimit: false,
        logLevel: 'silent',
      });
    });

    it('enables rate limiting only with RATE_LIMIT=true', () => {
      expect(loadConfig({ NODE_ENV: 'test', RATE_LIMIT: 'true' }).rateLimit).toBe(true);
      expect(loadConfig({ NODE_ENV: 'test', RATE_LIMIT: 'false' }).rateLimit).toBe(false);
    });
  });

  describe('TRUSTED_ORIGINS', () => {
    it('splits on commas and trims spaces', () => {
      const config = loadConfig({ TRUSTED_ORIGINS: ' http://a.test , http://b.test:8080,http://c.test ' });
      expect(config.trustedOrigins).toEqual(['http://a.test', 'http://b.test:8080', 'http://c.test']);
    });

    it('drops empty entries', () => {
      expect(loadConfig({ TRUSTED_ORIGINS: 'http://a.test,, ,' }).trustedOrigins).toEqual([
        'http://a.test',
      ]);
      expect(loadConfig({ TRUSTED_ORIGINS: '' }).trustedOrigins).toEqual([]);
    });
  });

  describe('PUBLIC_URL', () => {
    it.each([
      ['https://ambiance.example.com/', 'https://ambiance.example.com'],
      ['https://ambiance.example.com///', 'https://ambiance.example.com'],
      ['https://ambiance.example.com', 'https://ambiance.example.com'],
      ['http://localhost:3000/', 'http://localhost:3000'],
    ])('turns %s into %s', (PUBLIC_URL, expected) => {
      expect(loadConfig({ PUBLIC_URL }).publicUrl).toBe(expected);
    });
  });

  describe('other settings', () => {
    it('lowercases ADMIN_EMAIL', () => {
      expect(loadConfig({ ADMIN_EMAIL: 'Boss@Example.COM' }).adminEmail).toBe('boss@example.com');
    });

    it('reads boolean flags as true/false/1/0', () => {
      expect(loadConfig({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
      expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
      expect(loadConfig({ TRUST_PROXY: '0' }).trustProxy).toBe(false);
      expect(loadConfig({ RATE_LIMIT: '0' }).rateLimit).toBe(false);
    });

    it('derives the icons folder from WEB_DIST unless ICONS_DIR is set', () => {
      expect(loadConfig({ WEB_DIST: './dist' }).iconsDir).toBe(resolve('./dist', 'icons'));
      expect(loadConfig({ WEB_DIST: './dist', ICONS_DIR: './ic' }).iconsDir).toBe(resolve('./ic'));
    });
  });
});

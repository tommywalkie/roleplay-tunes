import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { sqlite } from '../db/index.js';

/**
 * Guards the rule that the suite never touches development data: tests that signed up
 * accounts or uploaded files into `tmp/dev-data` once filled it with hundreds of rows.
 */
describe('test isolation', () => {
  it('runs against an in-memory database', () => {
    expect(config.isTest).toBe(true);
    expect(config.databasePath).toBe(':memory:');
    expect(sqlite.memory).toBe(true);
  });

  it('ignores the settings a development shell or apps/server/.env would bring', () => {
    expect(config.contactFormOrigin).toBeNull();
    expect(config.webDist).toBeUndefined();
    expect(config.trustProxy).toBe(false);
    expect(config.publicUrl).toBe('http://localhost:3000');
  });

  it('stores audio and images in a throwaway folder, never in the development data', () => {
    const devData = resolve(import.meta.dirname, '../../../../tmp/dev-data');
    for (const dir of [config.dataDir, config.audioDir, config.imageDir, config.tmpDir]) {
      expect(dir.startsWith(devData), dir).toBe(false);
      expect(dir).toContain('server-test-data');
    }
  });
});

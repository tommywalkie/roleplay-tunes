/**
 * Vitest setup: keeps the suite fully separated from the development data.
 *
 * - Database: in memory (config.ts picks `:memory:` when NODE_ENV is "test").
 * - Files: a per-worker folder under the repository's gitignored `tmp/` directory.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll } from 'vitest';

const dataDir = resolve(
  import.meta.dirname,
  '../../../../tmp/server-test-data',
  `${process.pid}-${process.env.VITEST_POOL_ID ?? '0'}-${Date.now()}`,
);
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'http://localhost:3000';
delete process.env.ADMIN_EMAIL;
delete process.env.WEB_DIST;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

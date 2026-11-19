/**
 * Vitest setup: keeps the suite fully separated from the development data.
 *
 * - Database: in memory (config.ts picks `:memory:` when NODE_ENV is "test").
 * - Files: a per-worker folder under the repository's gitignored `tmp/` directory.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll } from 'vitest';

/**
 * Every server setting a developer may have exported in their shell (`config.ts`). The
 * suite starts from none of them, so a shell prepared for `pnpm dev:server` changes
 * nothing here. `apps/server/.env` is never read: only the dev script loads it.
 */
const SETTINGS = [
  'HOST',
  'PORT',
  'DATA_DIR',
  'PUBLIC_URL',
  'TRUSTED_ORIGINS',
  'AUTH_SECRET',
  'ADMIN_EMAIL',
  'WEB_DIST',
  'ICONS_DIR',
  'TRUST_PROXY',
  'RATE_LIMIT',
  'CONTACT_FORM_MODE',
  'CONTACT_FORM_PROVIDER',
  'CONTACT_FORM_ENDPOINT',
  'LOG_LEVEL',
];
for (const name of SETTINGS) delete process.env[name];

const dataDir = resolve(
  import.meta.dirname,
  '../../../../tmp/server-test-data',
  `${process.pid}-${process.env.VITEST_POOL_ID ?? '0'}-${Date.now()}`,
);
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_URL = 'http://localhost:3000';
// Checked by config.ts: without it, a run under Vitest refuses to start.
process.env.DND_SERVER_TEST_ISOLATED = '1';

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Isolate tests from the dev environment: in-memory DB (db/index.ts) and a
    // temp-dir audio store (src/test/setup.ts).
    setupFiles: ['src/test/setup.ts'],
    // Forced, so a NODE_ENV exported in the developer's shell cannot switch the database
    // from memory to a file (config.ts only uses ':memory:' when NODE_ENV is "test").
    env: { NODE_ENV: 'test' },
  },
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared package is TypeScript source: compile it into the bundle. Every other
  // dependency stays external and is installed normally.
  noExternal: ['@dnd/shared'],
  // The migrations SQL lives in `apps/server/drizzle/`, read at start; it is not bundled.
  external: ['drizzle-kit'],
});

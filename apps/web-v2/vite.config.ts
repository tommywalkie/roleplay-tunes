/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import cinzel from '@fontsource-variable/cinzel/package.json' with { type: 'json' };
import geistMono from '@fontsource-variable/geist-mono/package.json' with { type: 'json' };
import instrumentSans from '@fontsource-variable/instrument-sans/package.json' with { type: 'json' };
import pkg from './package.json' with { type: 'json' };

// Shown next to the product name: read in the app as import.meta.env.VITE_APP_VERSION.
process.env.VITE_APP_VERSION = pkg.version;
// Shown in the credits, beside each typeface: the versions actually bundled.
process.env.VITE_FONT_VERSIONS = JSON.stringify({
  'instrument-sans': instrumentSans.version,
  'geist-mono': geistMono.version,
  cinzel: cinzel.version,
});

// The API server trusts http://localhost:5173 by default (TRUSTED_ORIGINS), and the session
// cookie is same-origin through this proxy, so the port is fixed.
export default defineConfig({
  // No env files read by Vite: Node loads apps/web-v2/.env for the dev server only (see
  // the `dev` script), and Vite still exposes `VITE_*` variables from the environment. A
  // setting the server owns reaches the app at runtime instead (see contact.js).
  envDir: false,
  plugins: [
    react(),
    tailwindcss(),
    // In production the server fills in PUBLIC_URL; the build keeps the placeholder for it.
    {
      name: 'dev-public-url',
      apply: 'serve',
      transformIndexHtml: (html) => html.replaceAll('__PUBLIC_URL__', 'http://localhost:5173'),
    },
  ],
  build: {
    rolldownOptions: {
      output: {
        // A minified build drops every comment by default, and with them the copyright and
        // licence notices (`@license`, `/*!`) that MIT and ISC ask to keep in each copy.
        comments: { legal: true },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});

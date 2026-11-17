/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pkg from './package.json' with { type: 'json' };

// Shown next to the product name: read in the app as import.meta.env.VITE_APP_VERSION.
process.env.VITE_APP_VERSION = pkg.version;

// The API server trusts http://localhost:5173 by default (TRUSTED_ORIGINS), and the session
// cookie is same-origin through this proxy, so the port is fixed.
export default defineConfig({
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

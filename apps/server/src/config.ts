/**
 * Server settings, read once from the environment and validated. The server refuses to
 * start on an invalid value, and in production on a missing secret. See `.env.example`.
 */
import { resolve } from 'node:path';
import { z } from 'zod';

const DEV_SECRET = 'dev-only-secret-never-use-in-production-0123456789';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Holds the database, audio files and images. Back this directory up. */
  DATA_DIR: z
    .string()
    .min(1)
    // Dev default: the team's canonical dev database, so a plain `pnpm dev`
    // from the root serves the same data as the documented `DATA_DIR=../../tmp/dev-data`
    // runs. Tests and production always set DATA_DIR explicitly.
    .default('../../tmp/dev-data'),
  /** Public address of the app, as users type it (scheme and host, no trailing slash). */
  PUBLIC_URL: z.url().default('http://localhost:3000'),
  /** Extra browser origins allowed to call the API, comma separated (the dev web server). */
  TRUSTED_ORIGINS: z.string().default('http://localhost:5173'),
  AUTH_SECRET: z.string().min(32).optional(),
  /**
   * The account with this email is an admin. The default is an unrouteable
   * placeholder; production should set its own — see the sign-up race note in
   * `.env.example`.
   */
  ADMIN_EMAIL: z.email().default('admin@roleplay-tunes.local'),
  /** Folder of the built web app to serve. Empty: API only. */
  WEB_DIST: z.string().optional(),
  /** Folder of the built icon sets. Defaults to the web app's `icons` folder. */
  ICONS_DIR: z.string().optional(),
  /** Set when running behind a reverse proxy, so client addresses are read correctly. */
  TRUST_PROXY: bool(false),
  RATE_LIMIT: bool(true),
  /**
   * How the contact form works. `local`: this server stores the messages, and an
   * administrator reads them in the admin page. `provider`: the page posts the form to
   * CONTACT_FORM_ENDPOINT, whose origin must then join the Content-Security-Policy's
   * `form-action`. Empty (the default): no contact form at all.
   */
  CONTACT_FORM_MODE: z.enum(['', 'local', 'provider']).optional(),
  /** Which provider's field names `provider` mode posts with. Only `dsforms` is tried. */
  CONTACT_FORM_PROVIDER: z.enum(['dsforms', 'formspree', 'web3forms']).optional(),
  /** The form service's endpoint, in `provider` mode only. */
  CONTACT_FORM_ENDPOINT: z.url().optional().or(z.literal('').transform(() => undefined)),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
});

export interface Config {
  env: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  host: string;
  port: number;
  dataDir: string;
  /** `:memory:` under test, a file in the data directory otherwise. */
  databasePath: string;
  audioDir: string;
  imageDir: string;
  tmpDir: string;
  publicUrl: string;
  trustedOrigins: string[];
  authSecret: string;
  adminEmail: string;
  webDist: string | undefined;
  iconsDir: string;
  trustProxy: boolean;
  rateLimit: boolean;
  logLevel: string;
  /** How the contact form runs; `off` hides it. */
  contactFormMode: 'off' | 'local' | 'provider';
  /** The field-name convention `provider` mode posts with. */
  contactFormProvider: 'dsforms' | 'formspree' | 'web3forms';
  /** The form service's endpoint in `provider` mode. Null otherwise. */
  contactFormEndpoint: string | null;
  /** Origin of that endpoint, allowed as a form target. Null unless `provider`. */
  contactFormOrigin: string | null;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid server settings:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  // Vitest started without `apps/server/vitest.config.ts` (from the repo root, say) skips
  // `src/test/setup.ts`, which isolates the suite: files would land in the development data
  // folder, or the database would be a file. Only that setup sets the marker.
  if (source.VITEST && (!isTest || source.DND_SERVER_TEST_ISOLATED !== '1')) {
    throw new Error(
      'Server tests must run through apps/server/vitest.config.ts (`pnpm --filter @dnd/server ' +
        'test`), which keeps the development data out of reach',
    );
  }

  if (isProduction && !env.AUTH_SECRET) {
    throw new Error('Invalid server settings:\n  AUTH_SECRET: required in production');
  }
  if (isProduction && env.AUTH_SECRET === DEV_SECRET) {
    throw new Error('Invalid server settings:\n  AUTH_SECRET: the development secret is refused');
  }

  const contactFormMode =
    env.CONTACT_FORM_MODE === 'local' || env.CONTACT_FORM_MODE === 'provider'
      ? env.CONTACT_FORM_MODE
      : 'off';
  if (contactFormMode === 'provider' && !env.CONTACT_FORM_PROVIDER) {
    throw new Error(
      'Invalid server settings:\n  CONTACT_FORM_PROVIDER: required when CONTACT_FORM_MODE=provider',
    );
  }
  if (contactFormMode === 'provider' && !env.CONTACT_FORM_ENDPOINT) {
    throw new Error(
      'Invalid server settings:\n  CONTACT_FORM_ENDPOINT: required when CONTACT_FORM_MODE=provider',
    );
  }

  const dataDir = resolve(env.DATA_DIR);
  const webDist = env.WEB_DIST ? resolve(env.WEB_DIST) : undefined;
  return {
    env: env.NODE_ENV,
    isProduction,
    isTest,
    host: env.HOST,
    port: env.PORT,
    dataDir,
    databasePath: isTest ? ':memory:' : resolve(dataDir, 'app.db'),
    audioDir: resolve(dataDir, 'audio'),
    imageDir: resolve(dataDir, 'images'),
    tmpDir: resolve(dataDir, 'tmp'),
    publicUrl: env.PUBLIC_URL.replace(/\/+$/, ''),
    trustedOrigins: env.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    authSecret: env.AUTH_SECRET ?? DEV_SECRET,
    adminEmail: env.ADMIN_EMAIL.toLowerCase(),
    webDist,
    iconsDir: env.ICONS_DIR
      ? resolve(env.ICONS_DIR)
      : webDist
        ? resolve(webDist, 'icons')
        : resolve('../web-v2/public/icons'),
    trustProxy: env.TRUST_PROXY,
    rateLimit: isTest ? source.RATE_LIMIT === 'true' : env.RATE_LIMIT,
    logLevel: env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
    contactFormMode,
    contactFormProvider: env.CONTACT_FORM_PROVIDER ?? 'dsforms',
    contactFormEndpoint: contactFormMode === 'provider' ? (env.CONTACT_FORM_ENDPOINT ?? null) : null,
    contactFormOrigin:
      contactFormMode === 'provider' && env.CONTACT_FORM_ENDPOINT
        ? new URL(env.CONTACT_FORM_ENDPOINT).origin
        : null,
  };
}

export const config = loadConfig();

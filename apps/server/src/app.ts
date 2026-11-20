import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes, promoteConfiguredAdmin } from './auth.js';
import { config } from './config.js';
import { ensureSchema, sqlite } from './db/index.js';
import { registerErrorHandling } from './errors.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { imagesRoutes } from './routes/images.js';
import { libraryRoutes } from './routes/library.js';
import { mixesRoutes } from './routes/mixes.js';
import { scenesRoutes } from './routes/scenes.js';
import { soundsRoutes } from './routes/sounds.js';
import { tagsRoutes } from './routes/tags.js';
import { termsRoutes } from './routes/terms.js';
import { changelogRoutes } from './routes/changelog.js';
import { contactRoutes } from './routes/contact.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  // The route schemas exist to document the API in Swagger. They must not validate: Fastify's
  // validator coerces values (`name: 5` becomes "5", `'0.5'` becomes 0.5) and cannot read a
  // multipart body, so it would accept input the contract refuses and refuse every upload.
  // Every handler validates with the zod schemas of @dnd/shared instead.
  app.setValidatorCompiler(() => () => true);

  await ensureSchema();
  for (const dir of [config.audioDir, config.imageDir, config.tmpDir]) {
    mkdirSync(dir, { recursive: true });
  }
  promoteConfiguredAdmin();

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'validator.swagger.io', '*'],
        connectSrc: ["'self'", '*'],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        // A provider contact form posts straight to the form service; its origin must be
        // allowed here or the browser refuses to submit.
        formAction: ["'self'", ...(config.contactFormOrigin ? [config.contactFormOrigin] : [])],
        // Only meaningful over HTTPS; the reverse proxy terminates TLS.
        upgradeInsecureRequests: null,
      },
    },
    // Sent only when the public address is HTTPS.
    strictTransportSecurity: config.publicUrl.startsWith('https://'),
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  if (config.rateLimit) {
    await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  }

  await app.register(multipart, { limits: { files: 1, fields: 20, fieldSize: 64 * 1024 } });

  // Adds reply.sendFile() with Range support. Nothing is served automatically: the
  // routes that send files check ownership first.
  await app.register(fastifyStatic, { root: config.audioDir, serve: false });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Roleplay Tunes API',
        description: 'API for the Roleplay Tunes soundboard application',
        version: appVersion(),
      },
      servers: [{ url: config.publicUrl, description: 'Server' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'session',
            description: 'Session cookie from /api/auth/sign-in/email',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  registerErrorHandling(app);

  app.get('/api/health', {
    schema: {
      tags: ['system'],
      summary: 'Health check',
      description: 'Returns server health status. Checks database connectivity and disk write access.',
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
        503: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    try {
      sqlite.prepare('select 1').get();
      await access(config.dataDir, constants.W_OK);
      return { ok: true };
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed');
      return reply.code(503).send({ ok: false });
    }
  });

  authRoutes(app);
  accountRoutes(app);
  adminRoutes(app);
  imagesRoutes(app);
  libraryRoutes(app);
  soundsRoutes(app);
  mixesRoutes(app);
  scenesRoutes(app);
  tagsRoutes(app);
  termsRoutes(app);
  changelogRoutes(app);
  contactRoutes(app);

  serveWebApp(app);

  return app;
}

/** The app's icons and social preview, which other sites may show. */
const BRAND_FILES = new Set([
  '/favicon.svg',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/og-image.png',
  '/manifest.webmanifest',
]);

/**
 * Lets any other site, such as a self-hosted dashboard, show or fetch the app's icons.
 * Uploaded images of sounds, mixes and scenes are not part of this.
 */
function shareBrandFiles(app: FastifyInstance) {
  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0];
    if (!BRAND_FILES.has(path)) return payload;
    reply.header('cross-origin-resource-policy', 'cross-origin');
    reply.header('access-control-allow-origin', '*');
    return payload;
  });
}

/**
 * The app's version, from the `package.json` the server runs beside: the root, web and server
 * files all carry it, so the OpenAPI document shows the release it describes. Resolved from
 * the working directory, like `drizzle/` and `changelog/`.
 */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Serves the built web app and falls back to its index page for client-side routes. The
 * index page carries the absolute addresses crawlers need (`og:image`, `og:url`), filled
 * in from PUBLIC_URL.
 */
function serveWebApp(app: FastifyInstance) {
  const root = config.webDist;
  if (!root || !existsSync(join(root, 'index.html'))) return;
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8').replaceAll(
    '__PUBLIC_URL__',
    config.publicUrl,
  );

  shareBrandFiles(app);

  app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
    index: false,
    globIgnore: ['index.html'],
    setHeaders(res, path) {
      // Hashed build assets never change; the index page must always be re-checked.
      res.header(
        'cache-control',
        path.includes(`${join(root, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  app.get('/*', (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.callNotFound();
    reply.header('cache-control', 'no-cache');
    return reply.type('text/html; charset=utf-8').send(indexHtml);
  });
}

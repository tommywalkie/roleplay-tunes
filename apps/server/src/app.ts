import { existsSync, mkdirSync } from 'node:fs';
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
import { mixesRoutes } from './routes/mixes.js';
import { scenesRoutes } from './routes/scenes.js';
import { soundsRoutes } from './routes/sounds.js';

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
        formAction: ["'self'"],
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
        title: 'D&D Ambiance API',
        description: 'API for the D&D Ambiance soundboard application',
        version: '0.0.0',
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
  soundsRoutes(app);
  mixesRoutes(app);
  scenesRoutes(app);

  serveWebApp(app);

  return app;
}

/** Serves the built web app and falls back to its index page for client-side routes. */
function serveWebApp(app: FastifyInstance) {
  const root = config.webDist;
  if (!root || !existsSync(join(root, 'index.html'))) return;

  app.register(fastifyStatic, {
    root,
    prefix: '/',
    decorateReply: false,
    wildcard: false,
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
    return reply.sendFile('index.html', root);
  });
}

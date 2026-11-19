import { randomUUID } from 'node:crypto';
import { contactSubmissionSchema } from '@dnd/shared';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { contactMessages } from '../db/schema.js';
import { notFound, parse } from '../errors.js';

/**
 * The contact form: the endpoint that keeps a message, and the settings the web app reads.
 *
 * `POST /api/contact` stores the message (`local` mode only); in `provider` mode the page
 * posts to the form service instead, so the route answers "not found" and nothing is kept.
 *
 * `GET /api/settings/contact.js` hands the app the mode, provider and endpoint at runtime.
 * The browser cannot read the server's environment, and a build-time value would freeze the
 * choice into the bundle, so `index.html` loads this script before the app starts.
 */
export function contactRoutes(app: FastifyInstance) {
  app.post(
    '/api/contact',
    {
      // Stricter than the global limit: a person sends one or two, not dozens.
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['contact'],
        summary: 'Send a contact message',
        description:
          'Stores a message from the contact form in `local` mode. A filled honeypot is ' +
          'quietly dropped, so a bot sees the same success a person does.',
        body: {
          type: 'object',
          required: ['name', 'email', 'message'],
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            message: { type: 'string' },
            _honeypot: { type: 'string' },
          },
        },
        response: { 204: { type: 'null', description: 'Message accepted' } },
      },
    },
    async (request, reply) => {
      if (config.contactFormMode !== 'local') throw notFound('Contact form');
      const body = parse(contactSubmissionSchema, request.body);
      // A filled honeypot is a bot: accept it and store nothing.
      if (body._honeypot === '') {
        db.insert(contactMessages)
          .values({
            id: randomUUID(),
            name: body.name,
            email: body.email,
            message: body.message,
            createdAt: new Date(),
            readAt: null,
          })
          .run();
      }
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/settings/contact.js',
    // Not part of the JSON API: no schema, and nothing to show in the docs.
    { schema: { hide: true } },
    async (_request, reply) => {
      reply.header('content-type', 'text/javascript; charset=utf-8');
      // A restart must apply a change, so the page never keeps an old answer.
      reply.header('cache-control', 'no-cache');
      return `window.__CONTACT_FORM__ = ${JSON.stringify({
        mode: config.contactFormMode,
        provider: config.contactFormProvider,
        endpoint: config.contactFormEndpoint,
      })};\n`;
    },
  );
}

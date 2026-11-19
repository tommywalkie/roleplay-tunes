import type { FastifyInstance } from 'fastify';
import { localeSchema, type Changelog } from '@dnd/shared';
import { requireUser } from '../auth.js';
import { changelog } from '../changelog.js';
import { invalid } from '../errors.js';

/** The release notes, read by signed-in users. */
export function changelogRoutes(app: FastifyInstance) {
  app.get(
    '/api/changelog/:locale',
    {
      schema: {
        tags: ['changelog'],
        summary: 'Release notes',
        description:
          'Every release of the app, newest first, with its notes in one language as sanitized ' +
          'HTML. A release not translated yet comes in English.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['locale'],
          properties: {
            locale: { type: 'string', enum: ['en', 'fr'], description: 'The language' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['latest', 'releases'],
            properties: {
              latest: { type: 'string', nullable: true, description: 'The newest version' },
              releases: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['version', 'date', 'html'],
                  properties: {
                    version: { type: 'string' },
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    html: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request): Promise<Changelog> => {
      await requireUser(request);
      const { locale } = request.params as { locale: string };
      const parsed = localeSchema.safeParse(locale);
      if (!parsed.success) throw invalid('Unknown language', { locale: 'Unknown language' });
      return changelog(parsed.data);
    },
  );
}

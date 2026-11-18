import type { FastifyInstance } from 'fastify';
import { localeSchema, type Terms } from '@dnd/shared';
import { requireUser } from '../auth.js';
import { invalid } from '../errors.js';
import { acceptTerms, publicTerms } from '../terms.js';

const termsResponse = {
  type: 'object',
  required: ['enabled', 'updatedAt', 'html'],
  properties: {
    enabled: { type: 'boolean', description: 'Whether this server shows the rules at all' },
    updatedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When the rules were last changed, or null while none were written',
    },
    html: {
      type: 'string',
      description: 'The sanitized rules in this language; empty when none were written',
    },
  },
} as const;

/** The rules, which everyone reads, and their acceptance, which only a signed-in user gives. */
export function termsRoutes(app: FastifyInstance) {
  app.get(
    '/api/terms/:locale',
    {
      schema: {
        tags: ['terms'],
        summary: 'The server rules',
        description:
          'The rules of this server in one language, sanitized on the way in. No sign-in needed: ' +
          'the sign-up screen shows them before anyone has an account.',
        params: {
          type: 'object',
          required: ['locale'],
          properties: {
            locale: { type: 'string', enum: ['en', 'fr'], description: 'The language' },
          },
        },
        response: { 200: termsResponse },
      },
    },
    async (request): Promise<Terms> => {
      const { locale } = request.params as { locale: string };
      const parsed = localeSchema.safeParse(locale);
      if (!parsed.success) throw invalid('Unknown language', { locale: 'Unknown language' });
      return publicTerms(parsed.data);
    },
  );

  app.post(
    '/api/terms/accept',
    {
      schema: {
        tags: ['terms'],
        summary: 'Accept the server rules',
        description:
          'Records that the user accepted the rules as they stand. Called on sign-up and again ' +
          'whenever an administrator changes them.',
        security: [{ bearerAuth: [] }],
        response: { 204: { type: 'null', description: 'Accepted' } },
      },
    },
    async (request, reply) => {
      const user = await requireUser(request);
      acceptTerms(user.id);
      return reply.code(204).send();
    },
  );
}

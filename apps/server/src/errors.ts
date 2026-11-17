import type { FastifyError, FastifyInstance } from 'fastify';
import type { ApiError, ErrorCode } from '@dnd/shared';
import { ZodError, type z } from 'zod';

/** An error with a deliberate HTTP status and a stable code the web app can translate. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, 'unauthorized', 'Sign in required');
export const forbidden = (message = 'Not allowed') => new AppError(403, 'forbidden', message);
/** Also used for resources owned by someone else: their existence is not revealed. */
export const notFound = (what = 'Resource') => new AppError(404, 'not_found', `${what} not found`);
export const invalid = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'validation', message, fields);

function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    fields[path] ??= issue.message;
  }
  return fields;
}

/** Parses untrusted input, turning a schema failure into a 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid('Invalid request', zodFields(result.error));
  return result.data;
}

function body(code: ErrorCode, message: string, fields?: Record<string, string>): ApiError {
  return { error: fields ? { code, message, fields } : { code, message } };
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'file_too_large',
  415: 'unsupported_type',
  429: 'rate_limited',
};

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send(body(error.code, error.message, error.fields));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send(body('validation', 'Invalid request', zodFields(error)));
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Errors raised by Fastify itself or a plugin: bad JSON, payload too large, rate limit.
      return reply.code(status).send(body(STATUS_CODES[status] ?? 'validation', error.message));
    }
    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send(body('internal', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(body('not_found', `Route ${request.method} ${request.url} not found`));
  });
}

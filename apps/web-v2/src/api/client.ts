import type { ErrorCode } from '@dnd/shared';

/** A failed API call, with the server's stable code so the UI can translate it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network' | 'invalid_credentials' | 'user_exists' | 'invalid_token',
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BETTER_AUTH_CODES: Record<string, ApiError['code']> = {
  INVALID_EMAIL_OR_PASSWORD: 'invalid_credentials',
  USER_ALREADY_EXISTS: 'user_exists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'user_exists',
  INVALID_TOKEN: 'invalid_token',
  signups_closed: 'signups_closed',
  BANNED_USER: 'forbidden',
};

const STATUS_CODES: Record<number, ApiError['code']> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'file_too_large',
  415: 'unsupported_type',
  429: 'rate_limited',
};

/** Reads either error shape: the API's `{ error: { code } }` or Better Auth's `{ code }`. */
async function toError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: fall back to the status.
  }
  const obj = (body ?? {}) as {
    error?: { code?: ErrorCode; message?: string; fields?: Record<string, string> };
    code?: string;
    message?: string;
  };
  if (obj.error?.code) {
    return new ApiError(res.status, obj.error.code, obj.error.message ?? '', obj.error.fields);
  }
  const code =
    (obj.code && BETTER_AUTH_CODES[obj.code]) ||
    STATUS_CODES[res.status] ||
    (res.status >= 500 ? 'internal' : 'validation');
  return new ApiError(res.status, code, obj.message ?? res.statusText);
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as multipart. */
  form?: FormData;
}

export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: opts.json !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.form,
    });
  } catch {
    throw new ApiError(0, 'network', 'Network error');
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

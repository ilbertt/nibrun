import type { Context } from 'elysia';
import { ForbiddenError } from '#lib/errors.ts';

const SQLITE_REQUEST_TIMEOUT_MS = 30_000;

export function sqliteRequestSignal(request: Request): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(SQLITE_REQUEST_TIMEOUT_MS)]);
}

export function assertSqliteOrigin({
  request,
  allowedOrigin,
}: {
  request: Request;
  allowedOrigin: string;
}): void {
  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin !== null && suppliedOrigin !== allowedOrigin) {
    throw new ForbiddenError('This origin cannot access SQLite connections.');
  }
}

export const SQLITE_CLIENT_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

export function assertSqliteClientOrigin({
  request,
  allowedOrigin,
}: {
  request: Request;
  allowedOrigin: string;
}): void {
  const suppliedOrigin = request.headers.get('origin');
  const hasBearerToken = /^Bearer \S+$/i.test(request.headers.get('authorization') ?? '');
  if (suppliedOrigin !== 'null' && hasBearerToken && !request.headers.has('cookie')) {
    return;
  }
  assertSqliteOrigin({ request, allowedOrigin });
}

export function sqliteClientCors({ set }: Pick<Context, 'set'>): void {
  Object.assign(set.headers, SQLITE_CLIENT_CORS_HEADERS);
}

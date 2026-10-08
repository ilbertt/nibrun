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

export function assertSqliteCookieOrigin(input: { request: Request; allowedOrigin: string }): void {
  if (input.request.headers.has('cookie')) {
    assertSqliteOrigin(input);
  }
}

import { createPublicApiClient } from '@repo/api-client/public';
import { ApiError, UsageError } from '#lib/errors.ts';

const SESSION_COOKIE = 'better-auth.session_token';
const SECURE_COOKIE_PREFIX = '__Secure-';

const NO_CREDENTIAL =
  'Set NIBRUN_COOKIE_TOKEN to the value of your better-auth.session_token cookie.';

export type Api = ReturnType<typeof createPublicApiClient>;

export type Credentials = {
  baseUrl: string;
  cookieToken?: string | undefined;
};

export function createApi(credentials: Credentials): Api {
  return createPublicApiClient({
    baseUrl: credentials.baseUrl,
    headers: authHeaders(credentials),
  });
}

/**
 * A session cookie, because it is the only credential the api can verify: it authenticates every
 * request through better-auth, and better-auth has been given no other way in. Borrowing a
 * browser's session is the placeholder for a CLI that has not been issued one of its own yet.
 */
export function authHeaders({ baseUrl, cookieToken }: Credentials): Record<string, string> {
  if (!cookieToken) {
    throw new UsageError(NO_CREDENTIAL);
  }
  return { cookie: `${sessionCookieName(baseUrl)}=${cookieToken}` };
}

// better-auth prefixes the cookie it sets whenever its own base URL is https, so what to call it
// follows the scheme of the api being addressed rather than being fixed here.
function sessionCookieName(baseUrl: string): string {
  const prefix = new URL(baseUrl).protocol === 'https:' ? SECURE_COOKIE_PREFIX : '';
  return `${prefix}${SESSION_COOKIE}`;
}

type Reply = { data: unknown; error: unknown };

/**
 * Eden hands back a failure rather than rejecting, and reports one it never sent as a 503 of its
 * own — so a refusal and an unreachable api arrive the same way, and both have to be raised here
 * or every call site reads as if it succeeded.
 */
export function unwrap<R extends Reply>(reply: R): NonNullable<R['data']> {
  if (reply.error !== null) {
    throw new ApiError(describeFailure(reply.error));
  }
  return reply.data as NonNullable<R['data']>;
}

// Eden wraps the body it was given in an `Error` whose message is that body stringified, which
// for the api's `{ error }` shape reads as `[object Object]`. The body itself is the message.
function describeFailure(failure: unknown): string {
  if (typeof failure !== 'object' || failure === null || !('value' in failure)) {
    return String(failure);
  }
  const { value } = failure;
  if (typeof value === 'object' && value !== null && 'error' in value) {
    return String(value.error);
  }
  return String(value);
}

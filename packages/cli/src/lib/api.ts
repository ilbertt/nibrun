import { createPublicApiClient } from '@repo/api-client/public';
import type { Credentials } from '#lib/credentials.ts';
import { ApiError } from '#lib/errors.ts';

export type Api = ReturnType<typeof createPublicApiClient>;

export type ApiInput = {
  baseUrl: string;
  credentials: Credentials | null;
};

export function createApi({ baseUrl, credentials }: ApiInput): Api {
  return createPublicApiClient({ baseUrl, headers: authHeaders({ baseUrl, credentials }) });
}

/**
 * Built even with nothing to put in it, because `nib login` is a command like any other and its
 * whole job is to get a credential. What keeps an unauthenticated request from being sent at all
 * is `requireSignedIn`, run before the handlers that need one.
 *
 * A token issued by a different api is no credential here, so it is left behind rather than sent
 * somewhere it can only be refused.
 */
export function authHeaders({ baseUrl, credentials }: ApiInput): Record<string, string> {
  if (!credentials || credentials.apiUrl !== baseUrl) {
    return {};
  }
  return { authorization: `Bearer ${credentials.accessToken}` };
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

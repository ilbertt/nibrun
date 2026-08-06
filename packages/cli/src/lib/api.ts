import { createPublicApiClient } from '@repo/api-client/public';

// The header better-auth's api-key plugin reads. Named after it rather than after us so a key
// minted by the api reaches this client unchanged the day that plugin is turned on.
const API_KEY_HEADER = 'x-api-key';

export type Api = ReturnType<typeof createPublicApiClient>;

export function createApi({ baseUrl, apiKey }: { baseUrl: string; apiKey: string }): Api {
  return createPublicApiClient({ baseUrl, headers: { [API_KEY_HEADER]: apiKey } });
}

export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
  }
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

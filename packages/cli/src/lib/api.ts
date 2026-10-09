import { createPublicApiClient, type PublicApiClient } from '@repo/api-client/public';
import { API_KEY_HEADER } from '@repo/api-constants';
import type { Credentials } from '#lib/credentials.ts';

export type ApiInput = {
  baseUrl: string;
  credentials: Credentials | null;
  apiKey: string | undefined;
};

export function createApi(input: ApiInput): PublicApiClient {
  return createPublicApiClient({ baseUrl: input.baseUrl, headers: authHeaders(input) });
}

/**
 * Built even with nothing to put in it, because `nib login` is a command like any other and its
 * whole job is to get a credential. What keeps an unauthenticated request from being sent at all
 * is `requireSignedIn`, run before the handlers that need one.
 *
 * A token issued by a different api is no credential here, so it is left behind rather than sent
 * somewhere it can only be refused.
 */
export function authHeaders({ baseUrl, credentials, apiKey }: ApiInput): Record<string, string> {
  if (apiKey !== undefined) {
    return { [API_KEY_HEADER]: apiKey };
  }
  if (!credentials || credentials.apiUrl !== baseUrl) {
    return {};
  }
  return { authorization: `Bearer ${credentials.accessToken}` };
}

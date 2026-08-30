import { useQuery } from '@tanstack/react-query';
import { oauthClientQueryOptions } from '#queries/oauth-client.ts';

export type OauthClientState =
  | { status: 'checking'; name?: undefined; reason?: undefined }
  | { status: 'known'; name: string; reason?: undefined }
  | { status: 'refused'; name?: undefined; reason: string };

/**
 * A name to put in the sentence the owner is answering. A client that registered itself may have
 * given none, and the id it registered under says more than an empty line would.
 */
export function useOauthClient(clientId: string): OauthClientState {
  const { isPending, isError, error, data } = useQuery(oauthClientQueryOptions(clientId));

  if (isPending) {
    return { status: 'checking' };
  }
  if (isError) {
    return { status: 'refused', reason: error.message };
  }
  return { status: 'known', name: data?.client_name || clientId };
}

import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

export const OAUTH_CLIENT_QUERY_KEY = 'oauth-client';

/**
 * The client's own account of itself, which is all a consent page has to show for it.
 *
 * Everything here was written by whoever registered the client, and anyone may register one — so
 * it names what is asking without vouching for it. That is what the warning beside it is for.
 */
export function oauthClientQueryOptions(clientId: string) {
  return queryOptions({
    queryKey: [OAUTH_CLIENT_QUERY_KEY, clientId],
    queryFn: async () => {
      const { data, error } = await authClient.oauth2.publicClient({
        query: { client_id: clientId },
      });
      if (error) {
        throw new Error(error.message ?? 'That application is not one we know.');
      }
      return data;
    },
    retry: false,
  });
}

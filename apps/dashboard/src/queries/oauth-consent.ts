import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

type OAuthConsentClient = NonNullable<
  Awaited<ReturnType<typeof authClient.oauth2.publicClientPrelogin>>['data']
>;

export type OAuthConsentRequest = { client: OAuthConsentClient };

export function oauthConsentQueryOptions(oauthQuery: string) {
  return queryOptions({
    queryKey: ['oauth-consent', oauthQuery],
    queryFn: async (): Promise<OAuthConsentRequest> => {
      const query = new URLSearchParams(oauthQuery);
      const clientId = query.get('client_id');
      if (!clientId) {
        throw new Error('Start the connection again from the app you want to connect.');
      }
      const { data, error } = await authClient.oauth2.publicClientPrelogin({
        client_id: clientId,
        oauth_query: oauthQuery,
      });
      if (error || !data) {
        throw new Error('This connection request is invalid or has expired. Start it again.');
      }
      return { client: data };
    },
    retry: false,
    staleTime: 0,
  });
}

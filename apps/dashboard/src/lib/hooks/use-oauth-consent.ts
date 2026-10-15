import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { type OAuthConsentRequest, oauthConsentQueryOptions } from '#queries/oauth-consent.ts';

export function useOAuthConsent(): UseQueryResult<OAuthConsentRequest, Error> {
  const oauthQuery = useOAuthQuery();
  return useQuery(oauthConsentQueryOptions(oauthQuery));
}

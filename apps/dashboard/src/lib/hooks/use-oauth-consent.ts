import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import { type OAuthConsentRequest, oauthConsentQueryOptions } from '#queries/oauth-consent.ts';

export function useOAuthConsent(): UseQueryResult<OAuthConsentRequest, Error> {
  const oauthQuery = useLocation({ select: (location) => location.searchStr });
  return useQuery(oauthConsentQueryOptions(oauthQuery));
}

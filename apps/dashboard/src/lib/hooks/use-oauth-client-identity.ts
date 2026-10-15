import { useOAuthConsent } from '#lib/hooks/use-oauth-consent.ts';
import { type OAuthClientIdentity, oauthClientIdentity } from '#lib/oauth-client-identity.ts';

export function useOAuthClientIdentity(): OAuthClientIdentity | undefined {
  const consent = useOAuthConsent();
  return consent.isSuccess ? oauthClientIdentity(consent.data.client) : undefined;
}

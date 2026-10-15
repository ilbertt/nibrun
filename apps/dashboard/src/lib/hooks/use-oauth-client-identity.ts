import { useQuery } from '@tanstack/react-query';
import { useOAuthConsent } from '#lib/hooks/use-oauth-consent.ts';
import { type OAuthClientIdentity, oauthClientIdentity } from '#lib/oauth-client-identity.ts';
import { oauthClientIconQueryOptions } from '#queries/oauth-client-icon.ts';

export function useOAuthClientIdentity(): OAuthClientIdentity | undefined {
  const consent = useOAuthConsent();
  const identity = consent.isSuccess ? oauthClientIdentity(consent.data.client) : undefined;
  const icon = useQuery(
    oauthClientIconQueryOptions(
      identity && !identity.logoUrl ? consent.data?.client.client_uri : undefined,
    ),
  );
  return identity
    ? { ...identity, logoUrl: identity.logoUrl ?? icon.data ?? undefined }
    : undefined;
}

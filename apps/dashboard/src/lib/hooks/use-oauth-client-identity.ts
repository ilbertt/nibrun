import type { AvatarImage } from '@repo/ui/components/avatar';
import { type ComponentProps, useState } from 'react';
import { useOAuthConsent } from '#lib/hooks/use-oauth-consent.ts';
import { type OAuthClientIdentity, oauthClientIdentity } from '#lib/oauth-client-identity.ts';

type ImageLoadingStatusChange = NonNullable<
  ComponentProps<typeof AvatarImage>['onLoadingStatusChange']
>;

type OAuthClientIdentityResult = {
  client: OAuthClientIdentity | undefined;
  logoUrl: string | undefined;
  onLogoLoadingStatusChange: ImageLoadingStatusChange;
};

export function useOAuthClientIdentity(): OAuthClientIdentityResult {
  const consent = useOAuthConsent();
  const client = consent.isSuccess ? oauthClientIdentity(consent.data.client) : undefined;
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const logoUrl = client?.logoUrls.find((url) => !failedUrls.includes(url));

  function onLogoLoadingStatusChange(...[status]: Parameters<ImageLoadingStatusChange>): void {
    if (status === 'error' && logoUrl) {
      setFailedUrls((urls) => [...urls, logoUrl]);
    }
  }

  return { client, logoUrl, onLogoLoadingStatusChange };
}

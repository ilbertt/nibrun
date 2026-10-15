import type { OAuthConsentRequest } from '#queries/oauth-consent.ts';

export type OAuthClientIdentity = {
  name: string;
  logoUrls: string[];
  domain: string | undefined;
};

const FAVICON_PATHS = ['/favicon.ico', '/favicon.svg', '/favicon.png'] as const;

function clientUrl(value: string | undefined): URL | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

export function oauthClientIdentity(client: OAuthConsentRequest['client']): OAuthClientIdentity {
  const website = clientUrl(client.client_uri);
  const logo = clientUrl(client.logo_uri);
  const favicons = website ? FAVICON_PATHS.map((path) => new URL(path, website).href) : [];
  return {
    name: client.client_name?.trim() || 'An app',
    logoUrls: [...new Set([...(logo ? [logo.href] : []), ...favicons])],
    domain: (clientUrl(client.client_id) ?? website)?.hostname,
  };
}

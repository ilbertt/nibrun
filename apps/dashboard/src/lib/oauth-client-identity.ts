import type { OAuthConsentRequest } from '#queries/oauth-consent.ts';

export type OAuthClientIdentity = {
  name: string;
  logoUrl: string | undefined;
  domain: string | undefined;
};

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
  return {
    name: client.client_name?.trim() || 'An app',
    logoUrl: clientUrl(client.logo_uri)?.href,
    domain: (clientUrl(client.client_id) ?? clientUrl(client.client_uri))?.hostname,
  };
}

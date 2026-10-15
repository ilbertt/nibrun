import type { authClient } from '#lib/auth.ts';

type ConsentResponse = NonNullable<Awaited<ReturnType<typeof authClient.oauth2.consent>>['data']>;

export function mcpConsentOutcome({
  accept,
  data,
}: {
  accept: boolean;
  data: ConsentResponse;
}): 'approved' | 'denied' | 'failed' {
  if (typeof data !== 'object' || data === null) {
    return 'failed';
  }
  const location =
    'url' in data ? data.url : 'redirect_uri' in data ? data.redirect_uri : undefined;
  if (typeof location !== 'string') {
    return 'failed';
  }
  try {
    const query = new URL(location).searchParams;
    if (accept && query.get('code') && !query.has('error')) {
      return 'approved';
    }
    return !accept && query.get('error') === 'access_denied' ? 'denied' : 'failed';
  } catch {
    return 'failed';
  }
}

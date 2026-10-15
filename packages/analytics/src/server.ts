import { UMAMI_WEBSITE_ID } from '#config.ts';
import type { AnalyticsEvent } from '#events.ts';
import { analyticsPath, analyticsSite } from '#page.ts';

export type ServerAnalyticsIdentity = {
  distinctId: string;
  userAgent: string;
};

const EMBEDDED_DESTINATIONS = new Set(['iframe', 'frame', 'embed', 'object']);

export function serverTrackingAllowed({ url, headers }: { url: URL; headers: Headers }): boolean {
  return (
    url.protocol === 'https:' &&
    analyticsSite(url.hostname) === 'dashboard' &&
    headers.get('dnt') !== '1' &&
    !EMBEDDED_DESTINATIONS.has(headers.get('sec-fetch-dest') ?? '')
  );
}

export function serverEventPayload({
  event,
  identity,
  accountId,
  identityState,
  url,
  pathname,
}: {
  event: AnalyticsEvent;
  identity: ServerAnalyticsIdentity;
  accountId: string | undefined;
  identityState: string;
  url: URL;
  pathname: string;
}): Record<string, unknown> {
  return {
    type: 'event',
    payload: {
      website: UMAMI_WEBSITE_ID,
      hostname: url.hostname,
      id: identity.distinctId,
      url: `${url.origin}${analyticsPath({ site: 'dashboard', pathname })}`,
      title: 'nibrun dashboard',
      referrer: '',
      name: event.name,
      data: {
        site: 'dashboard',
        identity_state: identityState,
        ...event.data,
        account_id: accountId,
      },
    },
  };
}

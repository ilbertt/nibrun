import { setAnalyticsAccountId, trackEvent, trackingAllowed } from '@repo/analytics';
import { useEffect, useRef } from 'react';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { useSession } from '#lib/hooks/use-session.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { signInFailureData } from '#lib/sign-in-failure.ts';

export function useMcpConsentAnalytics({ ready, error }: { ready: boolean; error: unknown }): void {
  const session = useSession();
  const identity = useSessionIdentity();
  const query = useOAuthQuery();
  const accountId = session?.user.isAnonymous ? undefined : session?.user.id;
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    const observation = `${ready ? 'view' : 'failure'}:${query}`;
    if (!trackingAllowed() || (!ready && !error) || previous.current === observation) {
      return;
    }
    previous.current = observation;
    setAnalyticsAccountId(accountId);
    if (ready) {
      trackEvent({ name: 'mcp_consent_viewed', data: { identity_state: identity } });
    } else {
      trackEvent({
        name: 'mcp_authorization_failed',
        data: { identity_state: identity, phase: 'request', ...signInFailureData(error) },
      });
    }
  }, [ready, error, identity, accountId, query]);
}

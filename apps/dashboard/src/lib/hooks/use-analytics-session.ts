import { setAnalyticsIdentityState, trackEvent, trackingAllowed } from '@repo/analytics';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';
import { takeSignIn, verifiedClaims } from '#lib/sign-in-analytics.ts';
import { appsQueryOptions } from '#queries/apps.ts';

export function useAnalyticsSession(): void {
  const identity = useSessionIdentity();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!trackingAllowed()) {
      return;
    }
    if (setAnalyticsIdentityState(identity)) {
      trackEvent({ name: 'session_seen', data: { identity_state: identity } });
    }
    if (identity !== SessionIdentity.WithAccount) {
      return;
    }
    const pending = takeSignIn();
    if (!pending) {
      return;
    }
    trackEvent({
      name: 'sign_in_completed',
      data: { identity_state: identity, reason: pending.reason },
    });
    if (pending.anonymous_app_ids.length === 0) {
      return;
    }
    void queryClient
      .fetchQuery(appsQueryOptions)
      .then((apps) => {
        for (const appId of verifiedClaims({ pending, apps })) {
          trackEvent({ name: 'app_claimed', data: { identity_state: identity, app_id: appId } });
        }
      })
      .catch(function ignoreAnalyticsFailure() {});
  }, [identity, queryClient]);
}

import {
  setAnalyticsAccountId,
  setAnalyticsIdentityState,
  trackEvent,
  trackingAllowed,
} from '@repo/analytics';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from '#lib/hooks/use-session.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';
import { takeSignIn, verifiedClaims } from '#lib/sign-in-analytics.ts';
import { appsQueryOptions } from '#queries/apps.ts';

export function useAnalyticsSession(): void {
  const identity = useSessionIdentity();
  const session = useSession();
  const accountId = identity === SessionIdentity.WithAccount ? session?.user.id : undefined;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!trackingAllowed()) {
      return;
    }
    const accountChanged = setAnalyticsAccountId(accountId);
    if (setAnalyticsIdentityState(identity) || accountChanged) {
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
      data: {
        identity_state: identity,
        previous_identity_state: pending.previous_identity_state,
        reason: pending.reason,
      },
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
  }, [identity, accountId, queryClient]);
}

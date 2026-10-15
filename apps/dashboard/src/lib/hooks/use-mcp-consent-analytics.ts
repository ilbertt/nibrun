import { mcpAnalyticsAttempt, setAnalyticsAccountId, trackEvent } from '@repo/analytics';
import { useEffect } from 'react';
import { useSession } from '#lib/hooks/use-session.ts';

export function useMcpConsentAnalytics(ready: boolean): void {
  const session = useSession();
  const accountId = session?.user.isAnonymous ? undefined : session?.user.id;
  useEffect(() => {
    const attemptId = mcpAnalyticsAttempt();
    if (ready && accountId && attemptId) {
      setAnalyticsAccountId(accountId);
      trackEvent({ name: 'mcp_consent_viewed', data: { source: 'mcp', attempt_id: attemptId } });
    }
  }, [ready, accountId]);
}

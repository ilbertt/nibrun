import { trackEvent, trackingAllowed } from '@repo/analytics';
import { useEffect, useRef } from 'react';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { isMcpLogin, mcpLoginErrorCode } from '#lib/mcp-login-analytics.ts';
import { takeSignIn } from '#lib/sign-in-analytics.ts';

export function useMcpLoginAnalytics(): void {
  const query = useOAuthQuery();
  const identity = useSessionIdentity();
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!trackingAllowed() || !isMcpLogin(query) || previous.current === query) {
      return;
    }
    previous.current = query;
    trackEvent({ name: 'mcp_login_viewed', data: { identity_state: identity } });
    if (new URLSearchParams(query).has('error') && takeSignIn()?.reason === 'mcp') {
      trackEvent({
        name: 'sign_in_failed',
        data: {
          identity_state: identity,
          reason: 'mcp',
          provider: 'github',
          phase: 'callback',
          error_code: mcpLoginErrorCode(query),
          http_status: undefined,
        },
      });
    }
  }, [query, identity]);
}

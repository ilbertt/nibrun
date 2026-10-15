import { setAnalyticsAccountId, trackEvent } from '@repo/analytics';
import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { useSession } from '#lib/hooks/use-session.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { mcpConsentOutcome } from '#lib/mcp-consent-outcome.ts';
import { signInFailureData } from '#lib/sign-in-failure.ts';

export function useOAuthConsentDecision(): UseMutationResult<void, Error, boolean> {
  const oauthQuery = useOAuthQuery();
  const identity = useSessionIdentity();
  const session = useSession();
  return useMutation({
    mutationFn: async (accept: boolean) => {
      const { data, error } = await authClient.oauth2.consent(
        { accept, oauth_query: oauthQuery },
        {
          onSuccess({ data }) {
            setAnalyticsAccountId(session?.user.isAnonymous ? undefined : session?.user.id);
            const outcome = mcpConsentOutcome({ accept, data });
            if (outcome === 'failed') {
              trackEvent({
                name: 'mcp_authorization_failed',
                data: {
                  identity_state: identity,
                  phase: 'consent',
                  error_code: undefined,
                  http_status: undefined,
                },
              });
            } else {
              trackEvent({
                name:
                  outcome === 'approved'
                    ? 'mcp_authorization_completed'
                    : 'mcp_authorization_denied',
                data: { identity_state: identity },
              });
            }
          },
        },
      );
      if (error || !data) {
        throw new Error('Could not save your decision. Try again or restart the connection.', {
          cause: error,
        });
      }
    },
    onError(error) {
      setAnalyticsAccountId(session?.user.isAnonymous ? undefined : session?.user.id);
      trackEvent({
        name: 'mcp_authorization_failed',
        data: {
          identity_state: identity,
          phase: 'consent',
          ...signInFailureData(error.cause ?? error),
        },
      });
    },
  });
}

import { trackEvent, trackingAllowed } from '@repo/analytics';
import type { SignInProvider } from '@repo/api-constants';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { isMcpLogin } from '#lib/mcp-login-analytics.ts';
import { sameOriginPath } from '#lib/same-origin-path.ts';
import {
  cachedAnonymousApps,
  forgetSignIn,
  rememberSignIn,
  type SignInReason,
} from '#lib/sign-in-analytics.ts';
import { signInFailureData } from '#lib/sign-in-failure.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

type SignInResult = Awaited<ReturnType<typeof authClient.signIn.social>>;

export function useSignIn({
  provider,
  callbackURL,
  reason,
}: {
  provider: SignInProvider;
  callbackURL: string;
  reason: SignInReason;
}): UseMutationResult<SignInResult, unknown, void> {
  const landing = sameOriginPath(callbackURL) ?? IndexRoute.to;
  const identity = useSessionIdentity();
  const signInReason = isMcpLogin(window.location.search) ? 'mcp' : reason;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (trackingAllowed()) {
        rememberSignIn({
          provider,
          reason: signInReason,
          identity,
          anonymousAppIds: cachedAnonymousApps(queryClient),
        });
        trackEvent({
          name: 'sign_in_started',
          data: { identity_state: identity, reason: signInReason, provider },
        });
      }
      const result = await authClient.signIn.social({
        provider,
        callbackURL: landing,
        ...(signInReason === 'mcp' ? { errorCallbackURL: `/login${window.location.search}` } : {}),
      });
      if (result.error) {
        throw result.error;
      }
      return result;
    },
    onError: (error) => {
      forgetSignIn();
      trackEvent({
        name: 'sign_in_failed',
        data: {
          identity_state: identity,
          reason: signInReason,
          provider,
          phase: 'start',
          ...signInFailureData(error),
        },
      });
    },
  });
}

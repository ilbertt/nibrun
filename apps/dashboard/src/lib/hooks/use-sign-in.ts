import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { sameOriginPath } from '#lib/same-origin-path.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

type SignInResult = Awaited<ReturnType<typeof authClient.signIn.social>>;

// better-auth answers with the provider URL and the client follows it, so a
// resolved mutation means the browser is already on its way to GitHub.
export function useSignIn(callbackURL: string): UseMutationResult<SignInResult, Error, void> {
  const landing = sameOriginPath(callbackURL) ?? IndexRoute.to;
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.social({ provider: 'github', callbackURL: landing });
      if (result.error) {
        throw result.error;
      }
      return result;
    },
  });
}

import { type UseMutationResult, useMutation } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

type SignInResult = Awaited<ReturnType<typeof authClient.signIn.social>>;

// better-auth answers with the provider URL and the client follows it, so a
// resolved mutation means the browser is already on its way to GitHub.
export function useSignIn(callbackURL: string): UseMutationResult<SignInResult, Error, void> {
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signIn.social({ provider: 'github', callbackURL });
      if (result.error) {
        throw result.error;
      }
      return result;
    },
  });
}

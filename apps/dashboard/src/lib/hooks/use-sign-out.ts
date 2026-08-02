import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { authClient } from '#lib/auth.ts';
import { sessionQueryOptions } from '#queries/session.ts';

type SignOutResult = Awaited<ReturnType<typeof authClient.signOut>>;

export function useSignOut(): UseMutationResult<SignOutResult, Error, void> {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => authClient.signOut(),
    // Dropped, not invalidated: the guard reads the session with
    // `ensureQueryData`, which serves whatever is cached without regard for
    // staleness, so an invalidated entry would still hand it the signed-in user.
    // Re-running the guard with no session is what sends the browser to /login.
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
      await router.invalidate();
    },
  });
}

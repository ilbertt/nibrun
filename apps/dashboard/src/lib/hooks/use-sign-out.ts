import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { authClient } from '#lib/auth.ts';
import { sessionQueryOptions } from '#queries/session.ts';

export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: () => authClient.signOut(),
    // Re-running the guard with no session is what sends the browser to /login.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
      await router.invalidate();
    },
  });
}

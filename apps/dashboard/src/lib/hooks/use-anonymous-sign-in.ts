import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';
import { sessionQueryOptions } from '#queries/session.ts';

/**
 * Becoming a stranger: a session with no identity behind it, made the moment a deploy needs one.
 *
 * The cached session is dropped rather than invalidated, for the reason signing out drops it: the
 * route guard reads it with `ensureQueryData`, which serves whatever is cached, and the next
 * navigation is what should find the stranger there.
 */
export function useAnonymousSignIn(): () => Promise<void> {
  const queryClient = useQueryClient();

  return async () => {
    const { error } = await authClient.signIn.anonymous();
    if (error) {
      throw new Error(error.message ?? 'Could not start without an account.');
    }
    queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
  };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { authClient } from '#lib/auth.ts';
import { sessionQueryOptions } from '#queries/session.ts';

export function AppHeader() {
  const { data: session } = useQuery(sessionQueryOptions);
  const queryClient = useQueryClient();
  const router = useRouter();

  const signOut = useMutation({
    mutationFn: async () => {
      await authClient.signOut();
    },
    // Re-running the guard with no session is what sends the browser to /login.
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey });
      await router.invalidate();
    },
  });

  if (!session) {
    return null;
  }

  return (
    <header className="flex items-center justify-between border-gray-200 border-b px-8 py-4">
      <span className="text-gray-600 text-sm">{session.user.name || session.user.email}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        Sign out
      </button>
    </header>
  );
}

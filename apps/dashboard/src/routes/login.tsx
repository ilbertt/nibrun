import { useMutation } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { authClient } from '#lib/auth.ts';

type LoginSearch = {
  redirect?: string;
};

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? '/' });
    }
  },
  component: LoginPage,
});

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch();

  const signIn = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signIn.social({
        provider: 'github',
        callbackURL: redirectTo ?? '/',
      });
      if (error) {
        throw error;
      }
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="font-bold text-3xl">nibrun</h1>
          <p className="mt-2 text-gray-500">Sign in to continue.</p>
        </div>
        <button
          type="button"
          onClick={() => signIn.mutate()}
          disabled={signIn.isPending}
          className="rounded-md bg-gray-900 px-4 py-2.5 font-medium text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {signIn.isPending ? 'Redirecting…' : 'Continue with GitHub'}
        </button>
        {signIn.isError && (
          <p className="text-red-600 text-sm">Could not start sign-in. Please try again.</p>
        )}
      </div>
    </div>
  );
}

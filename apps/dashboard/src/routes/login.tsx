import { createFileRoute, redirect } from '@tanstack/react-router';
import { GithubSignInButton } from '#components/github-sign-in-button.tsx';
import { Route as IndexRoute } from '#routes/index.tsx';

type LoginSearch = {
  redirect?: string;
};

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? IndexRoute.to });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { redirect: redirectTo } = Route.useSearch();

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <h1 className="font-bold text-3xl">nibrun</h1>
          <p className="mt-2 text-gray-500">Sign in to continue.</p>
        </div>
        <GithubSignInButton callbackURL={redirectTo ?? IndexRoute.to} />
      </div>
    </div>
  );
}

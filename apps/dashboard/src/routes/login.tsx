import { createFileRoute, redirect } from '@tanstack/react-router';
import { GithubSignInButton } from '#components/github-sign-in-button.tsx';
import { Route as IndexRoute } from '#routes/index.tsx';

type LoginSearch = {
  redirect?: string;
};

// Signing in lands here when no destination was carried, so a destination equal
// to it is the same as none at all. Called rather than captured: a route's `to`
// is only filled in once the router has been built.
function defaultDestination(): string {
  return IndexRoute.to;
}

/** The search that gets a visitor back to `destination` once they have signed in. */
export function searchForDestination(destination: string): LoginSearch {
  return destination === defaultDestination() ? {} : { redirect: destination };
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? defaultDestination() });
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
        <GithubSignInButton callbackURL={redirectTo ?? defaultDestination()} />
      </div>
    </div>
  );
}

import { createFileRoute, redirect } from '@tanstack/react-router';
import { TerminalIcon } from 'lucide-react';
import { GithubSignInButton } from '#components/github-sign-in-button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#components/ui/card.tsx';
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TerminalIcon className="size-4" />
          </div>
          nibrun
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <GithubSignInButton callbackURL={redirectTo ?? IndexRoute.to} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

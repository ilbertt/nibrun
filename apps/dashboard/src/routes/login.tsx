import { createFileRoute, redirect } from '@tanstack/react-router';
import { TerminalIcon } from 'lucide-react';
import { LoginForm } from '#components/login/login-form.tsx';
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
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TerminalIcon className="size-4" />
          </div>
          nibrun
        </div>
        <LoginForm />
      </div>
    </div>
  );
}

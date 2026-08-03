import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import { AppDevtools } from '#components/app-devtools.tsx';
import { AppShell } from '#components/app-shell.tsx';
import { sessionQueryOptions } from '#queries/session.ts';
import { Route as IndexRoute } from '#routes/index.tsx';
import { Route as LoginRoute } from '#routes/login.tsx';

import '../styles.css';

// Guarding at the root, rather than under a pathless layout, is what makes it
// impossible to add a route that forgets to ask for a session: every route is
// already behind this, and signing in is the one path that cannot be.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (!session && location.pathname !== LoginRoute.to) {
      // Home is where signing in lands you with no destination, so saying so
      // would only put a `?redirect=%2F` in front of the user.
      const isHome = location.href === IndexRoute.to;
      throw redirect({
        to: LoginRoute.to,
        search: isHome ? {} : { redirect: location.href },
      });
    }

    return { session };
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <AppShell>
        <Outlet />
      </AppShell>
      <AppDevtools />
    </>
  );
}

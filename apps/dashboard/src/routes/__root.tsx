import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import { AppDevtools } from '#components/app-devtools.tsx';
import { sessionQueryOptions } from '#queries/session.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';
import { Route as DeployRoute } from '#routes/deploy.tsx';

import '../styles.css';

// Enumerated rather than opted into, so the guard below stays the thing that decides who is
// public: signing in cannot itself require a session, and the landing page frames /deploy to
// post a binary here before anyone has signed in.
//
// A function, not a module-level set: these routes import this module back, so at evaluation
// time their `to` is still undefined and every path — including /login — would read as private.
function isPublic(pathname: string): boolean {
  return pathname === LoginRoute.to || pathname === DeployRoute.to;
}

// Guarding at the root, rather than under a pathless layout, is what makes it
// impossible to add a route that forgets to ask for a session: every route is
// already behind this, and the paths above are the only ones that cannot be.
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (!session && !isPublic(location.pathname)) {
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
      <Outlet />
      <AppDevtools />
    </>
  );
}

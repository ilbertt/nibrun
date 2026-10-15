import { useAnalytics } from '@repo/analytics';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import { AnalyticsSession } from '#components/analytics-session.tsx';
import { AppDevtools } from '#components/app-devtools.tsx';
import { sameOriginPath } from '#lib/same-origin-path.ts';
import { sessionQueryOptions } from '#queries/session.ts';
import { Route as ConsentRoute } from '#routes/(auth)/consent.tsx';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';
import { Route as DeployRoute } from '#routes/deploy.tsx';

import '../styles.css';

// Consent owns its account guard to preserve the signed OAuth query when redirecting to login.
// These routes import this module back, so their `to` is undefined during module evaluation.
function isPublic(pathname: string): boolean {
  return pathname === LoginRoute.to || pathname === DeployRoute.to || pathname === ConsentRoute.to;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQueryOptions);

    if (!session && !isPublic(location.pathname)) {
      const destination = sameOriginPath(location.href);
      // Home is where signing in lands you with no destination, so saying so
      // would only put a `?redirect=%2F` in front of the user.
      const landsHome = destination === undefined || destination === IndexRoute.to;
      throw redirect({
        to: LoginRoute.to,
        search: landsHome ? {} : { redirect: destination },
      });
    }

    return { session };
  },
  component: RouteComponent,
});

function RouteComponent() {
  useAnalytics();
  return (
    <>
      <AnalyticsSession />
      <Outlet />
      <AppDevtools />
    </>
  );
}

import { createFileRoute, redirect } from '@tanstack/react-router';
import { OAuthConsent } from '#components/oauth/oauth-consent.tsx';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';

export const Route = createFileRoute('/(auth)/consent')({
  beforeLoad: ({ context }) => {
    if (!context.session || context.session.user.isAnonymous === true) {
      throw redirect({ href: `${LoginRoute.to}${window.location.search}`, reloadDocument: true });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <OAuthConsent />;
}

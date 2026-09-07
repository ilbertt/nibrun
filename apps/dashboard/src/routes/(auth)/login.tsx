import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginForm } from '#components/login/login-form.tsx';
import { sameOriginPath } from '#lib/same-origin-path.ts';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

type LoginSearch = {
  redirect?: string;
};

export const Route = createFileRoute('/(auth)/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: sameOriginPath(search.redirect),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: search.redirect ?? IndexRoute.to });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return <LoginForm />;
}

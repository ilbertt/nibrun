import { createFileRoute } from '@tanstack/react-router';
import { LoginForm } from '#components/login/login-form.tsx';
import { beforeLogin, validateLoginSearch } from '#lib/login-route.ts';

export const Route = createFileRoute('/(auth)/login')({
  validateSearch: validateLoginSearch,
  beforeLoad: beforeLogin,
  component: RouteComponent,
});

function RouteComponent() {
  return <LoginForm />;
}

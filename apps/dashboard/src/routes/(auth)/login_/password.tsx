import { createFileRoute } from '@tanstack/react-router';
import { PasswordLoginForm } from '#components/login/password-login-form.tsx';
import { beforeLogin, validateLoginSearch } from '#lib/login-route.ts';

export const Route = createFileRoute('/(auth)/login_/password')({
  validateSearch: validateLoginSearch,
  beforeLoad: beforeLogin,
  component: RouteComponent,
});

function RouteComponent() {
  return <PasswordLoginForm />;
}

import { Button } from '@repo/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { Field, FieldError, FieldLabel } from '@repo/ui/components/field';
import { Input } from '@repo/ui/components/input';
import { Spinner } from '@repo/ui/components/spinner';
import { useId } from 'react';
import { useMcpLoginAnalytics } from '#lib/hooks/use-mcp-login-analytics.ts';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { usePasswordSignIn } from '#lib/hooks/use-password-sign-in.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';

export function PasswordLoginForm() {
  useMcpLoginAnalytics();
  const form = usePasswordSignIn();
  const query = useOAuthQuery();
  const emailId = useId();
  const passwordId = useId();
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Demo account sign-in</CardTitle>
        <CardDescription>Use the credentials provided for your demo account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.submit();
          }}
        >
          <Field>
            <FieldLabel htmlFor={emailId}>Email</FieldLabel>
            <Input
              id={emailId}
              type="email"
              autoComplete="username"
              required
              value={form.fields.email}
              disabled={form.pending}
              onChange={(event) => form.change({ field: 'email', value: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              value={form.fields.password}
              disabled={form.pending}
              onChange={(event) => form.change({ field: 'password', value: event.target.value })}
            />
          </Field>
          {form.failed && (
            <FieldError role="alert">
              Could not sign in. Check your credentials or restart the connection.
            </FieldError>
          )}
          <Button type="submit" size="lg" disabled={form.pending}>
            {form.pending && <Spinner />}
            Sign in
          </Button>
          <a
            href={`${LoginRoute.to}${query}`}
            className="text-center text-muted-foreground text-sm underline underline-offset-4"
          >
            Continue with GitHub
          </a>
        </form>
      </CardContent>
    </Card>
  );
}

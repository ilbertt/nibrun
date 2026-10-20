import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { GithubSignInButton } from '#components/login/github-sign-in-button.tsx';
import { useMcpLoginAnalytics } from '#lib/hooks/use-mcp-login-analytics.ts';
import { useOAuthQuery } from '#lib/hooks/use-oauth-query.ts';
import { Route as PasswordLoginRoute } from '#routes/(auth)/login_.password.tsx';

export function LoginForm() {
  useMcpLoginAnalytics();
  const query = useOAuthQuery();
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to continue.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <GithubSignInButton />
        <a
          href={`${PasswordLoginRoute.to}${query}`}
          className="text-center text-muted-foreground text-sm underline underline-offset-4"
        >
          Demo account sign-in
        </a>
      </CardContent>
    </Card>
  );
}

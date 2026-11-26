import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/card';
import { SocialSignInButton } from '#components/login/social-sign-in-button.tsx';
import { useLoginProviders } from '#lib/hooks/use-login-providers.ts';
import { useMcpLoginAnalytics } from '#lib/hooks/use-mcp-login-analytics.ts';

export function LoginForm() {
  useMcpLoginAnalytics();
  const providers = useLoginProviders();
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to continue.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {providers.map((provider) => (
          <SocialSignInButton key={provider} provider={provider} />
        ))}
      </CardContent>
    </Card>
  );
}

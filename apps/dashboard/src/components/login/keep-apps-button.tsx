import { SignInProvider } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { GithubMark } from '@repo/ui/custom/github-mark';
import { Link, useLocation } from '@tanstack/react-router';
import { useLoginProviders } from '#lib/hooks/use-login-providers.ts';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';

/**
 * The way out of being a stranger: signing in with an identity, which is what moves what they
 * hold to a profile that keeps it. Lands back where it was pressed, so the app they were looking
 * at is the app they come back to — theirs now.
 */
export function KeepAppsButton({ size }: { size: 'sm' | 'lg' }) {
  const here = useLocation({ select: (location) => location.href });
  const providers = useLoginProviders();
  const signIn = useSignIn({
    provider: SignInProvider.GitHub,
    callbackURL: here,
    reason: 'keep-app',
  });

  if (providers.length > 1) {
    return (
      <Button
        variant={size === 'lg' ? 'default' : 'outline'}
        size={size}
        render={<Link to="/login" search={{ redirect: here, reason: 'keep-app' }} />}
      >
        Sign in to keep it
      </Button>
    );
  }
  return (
    <Button
      variant={size === 'lg' ? 'default' : 'outline'}
      size={size}
      onClick={() => signIn.mutate()}
      disabled={signIn.isPending}
    >
      <GithubMark />
      {signIn.isPending ? 'Redirecting…' : 'Sign in to keep it'}
    </Button>
  );
}

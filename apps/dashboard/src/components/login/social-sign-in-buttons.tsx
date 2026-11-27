import { SignInProvider } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { GithubMark } from '@repo/ui/custom/github-mark';
import googleMark from '#icons/google-mark.png';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function SocialSignInButtons() {
  const { redirect, reason } = LoginRoute.useSearch();
  const signIn = useSignIn({ callbackURL: redirect ?? IndexRoute.to, reason: reason ?? 'login' });

  return (
    <Field data-invalid={signIn.isError || undefined}>
      {Object.entries(SignInProvider).map(([name, provider]) => (
        <Button
          key={provider}
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => signIn.mutate(provider)}
          disabled={signIn.isPending}
        >
          {provider === SignInProvider.GitHub ? (
            <GithubMark />
          ) : (
            <img className="size-4 object-contain" alt="" src={googleMark} />
          )}
          {signIn.isPending && signIn.variables === provider
            ? 'Redirecting…'
            : `Continue with ${name}`}
        </Button>
      ))}
      {signIn.isError && <FieldError>Could not start sign-in. Please try again.</FieldError>}
    </Field>
  );
}

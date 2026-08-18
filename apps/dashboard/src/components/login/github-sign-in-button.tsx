import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { GithubIcon } from '#icons/github-icon.tsx';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function GithubSignInButton() {
  const { redirect } = LoginRoute.useSearch();
  const signIn = useSignIn(redirect ?? IndexRoute.to);

  return (
    <Field data-invalid={signIn.isError || undefined}>
      <Button
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => signIn.mutate()}
        disabled={signIn.isPending}
      >
        <GithubIcon />
        {signIn.isPending ? 'Redirecting…' : 'Continue with GitHub'}
      </Button>
      {signIn.isError && <FieldError>Could not start sign-in. Please try again.</FieldError>}
    </Field>
  );
}

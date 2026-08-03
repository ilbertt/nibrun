import { useSearch } from '@tanstack/react-router';
import { Button } from '#components/ui/button.tsx';
import { Field, FieldError } from '#components/ui/field.tsx';
import { GithubIcon } from '#icons/github-icon.tsx';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';
import { Route as IndexRoute } from '#routes/index.tsx';

export function GithubSignInButton() {
  const { redirect } = useSearch({ from: '/login' });
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

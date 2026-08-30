import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { GithubIcon } from '#icons/github-icon.tsx';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';
import { resolveSignInTarget } from '#lib/oauth.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function GithubSignInButton() {
  const { redirect } = LoginRoute.useSearch();
  // The location rather than the parsed search: an authorize request arrives here signed, and
  // where it resumes has to be built from the query as it was signed. `redirect` is the
  // dashboard's own way back, and only decides where an ordinary sign-in lands.
  const signIn = useSignIn(
    resolveSignInTarget({
      search: window.location.search,
      fallback: redirect ?? IndexRoute.to,
    }),
  );

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

import { Button } from '#components/ui/button.tsx';
import { Field, FieldError } from '#components/ui/field.tsx';
import { GithubIcon } from '#icons/github-icon.tsx';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';

export function GithubSignInButton({ callbackURL }: { callbackURL: string }) {
  const signIn = useSignIn(callbackURL);

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

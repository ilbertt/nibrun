import { SignInProvider } from '@repo/api-constants';
import { Button } from '@repo/ui/components/button';
import { Field, FieldError } from '@repo/ui/components/field';
import { GithubMark } from '@repo/ui/custom/github-mark';
import { ChatGptIcon } from '#icons/chatgpt-icon.tsx';
import { useSignIn } from '#lib/hooks/use-sign-in.ts';
import { Route as LoginRoute } from '#routes/(auth)/login.tsx';
import { Route as IndexRoute } from '#routes/(dashboard)/index.tsx';

export function SocialSignInButton({ provider }: { provider: SignInProvider }) {
  const { redirect, reason } = LoginRoute.useSearch();
  const signIn = useSignIn({
    provider,
    callbackURL: redirect ?? IndexRoute.to,
    reason: reason ?? 'login',
  });

  const isChatGpt = provider === SignInProvider.ChatGPT;
  const label = isChatGpt ? 'Continue with ChatGPT' : 'Continue with GitHub';

  return (
    <Field data-invalid={signIn.isError || undefined}>
      <Button
        data-oai-siwc-button={isChatGpt ? '' : undefined}
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => signIn.mutate()}
        disabled={signIn.isPending}
      >
        {isChatGpt ? <ChatGptIcon /> : <GithubMark />}
        {signIn.isPending ? 'Redirecting…' : label}
      </Button>
      {signIn.isError && <FieldError>Could not start sign-in. Please try again.</FieldError>}
    </Field>
  );
}

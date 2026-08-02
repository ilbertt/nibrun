import { useSignIn } from '#lib/hooks/use-sign-in.ts';

export function GithubSignInButton({ callbackURL }: { callbackURL: string }) {
  const signIn = useSignIn(callbackURL);

  return (
    <>
      <button
        type="button"
        onClick={() => signIn.mutate()}
        disabled={signIn.isPending}
        className="rounded-md bg-gray-900 px-4 py-2.5 font-medium text-sm text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {signIn.isPending ? 'Redirecting…' : 'Continue with GitHub'}
      </button>
      {signIn.isError && (
        <p className="text-red-600 text-sm">Could not start sign-in. Please try again.</p>
      )}
    </>
  );
}

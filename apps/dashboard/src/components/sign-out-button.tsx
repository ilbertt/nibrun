import { useSignOut } from '#lib/hooks/use-sign-out.ts';

export function SignOutButton() {
  const signOut = useSignOut();

  return (
    <button
      type="button"
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
      className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
    >
      Sign out
    </button>
  );
}

import { useSession } from '#lib/hooks/use-session.ts';
import { useSignOut } from '#lib/hooks/use-sign-out.ts';

export function AppHeader() {
  const session = useSession();
  const signOut = useSignOut();

  if (!session) {
    return null;
  }

  return (
    <header className="flex items-center justify-between border-gray-200 border-b px-8 py-4">
      <span className="text-gray-600 text-sm">{session.user.name || session.user.email}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className="rounded-md border border-gray-300 px-3 py-1.5 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        Sign out
      </button>
    </header>
  );
}

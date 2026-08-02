import { SignOutButton } from '#components/sign-out-button.tsx';
import { useSession } from '#lib/hooks/use-session.ts';

export function AppHeader() {
  const session = useSession();

  if (!session) {
    return null;
  }

  return (
    <header className="flex items-center justify-between border-gray-200 border-b px-8 py-4">
      <span className="text-gray-600 text-sm">{session.user.name || session.user.email}</span>
      <SignOutButton />
    </header>
  );
}

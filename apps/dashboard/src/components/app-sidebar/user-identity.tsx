import { UserAvatar } from '#components/user-avatar.tsx';
import type { Session } from '#lib/auth.ts';

// A fragment so it drops straight into the trigger's slot children as well as
// the menu label's own row.
export function UserIdentity({ user }: { user: Session['user'] }) {
  return (
    <>
      <UserAvatar user={user} className="size-8" />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name || user.email}</span>
        <span className="truncate text-foreground/70 text-xs">{user.email}</span>
      </div>
    </>
  );
}

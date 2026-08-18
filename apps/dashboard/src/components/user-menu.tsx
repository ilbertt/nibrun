import { LogOutIcon } from 'lucide-react';
import { Button } from '#components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu.tsx';
import { UserAvatar } from '#components/user-avatar.tsx';
import { useSession } from '#lib/hooks/use-session.ts';
import { useSignOut } from '#lib/hooks/use-sign-out.ts';

export function UserMenu() {
  const session = useSession();
  const signOut = useSignOut();

  if (!session) {
    return null;
  }

  const { user } = session;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" className="rounded-lg" aria-label="Account" />
        }
      >
        <UserAvatar user={user} className="size-7" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56" align="end">
        {/* Base UI throws without it: a label is a group part, not a standalone one. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <UserAvatar user={user} className="size-8" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name || user.email}</span>
                <span className="truncate text-foreground/70 text-xs">{user.email}</span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Avatar, AvatarFallback, AvatarImage } from '#components/ui/avatar.tsx';
import type { Session } from '#lib/auth.ts';
import { cn } from '#lib/utils.ts';

const INITIALS_LENGTH = 2;

export function UserAvatar({ user, className }: { user: Session['user']; className?: string }) {
  const label = user.name || user.email;

  return (
    <Avatar className={cn('rounded-lg', className)}>
      <AvatarImage src={user.image ?? undefined} alt={label} />
      <AvatarFallback className="rounded-lg">
        {label.slice(0, INITIALS_LENGTH).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

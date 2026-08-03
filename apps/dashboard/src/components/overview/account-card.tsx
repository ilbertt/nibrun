import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card.tsx';
import { UserAvatar } from '#components/user-avatar.tsx';
import { useSession } from '#lib/hooks/use-session.ts';

export function AccountCard() {
  const session = useSession();

  if (!session) {
    return null;
  }

  const { user } = session;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>Signed in as</CardDescription>
        <CardTitle className="truncate font-semibold @[250px]/card:text-3xl text-2xl">
          {user.name || user.email}
        </CardTitle>
        <CardAction>
          <UserAvatar user={user} className="size-9" />
        </CardAction>
      </CardHeader>
      <CardFooter className="truncate text-muted-foreground text-sm">{user.email}</CardFooter>
    </Card>
  );
}

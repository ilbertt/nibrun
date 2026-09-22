import { RenameAppDialog } from '#components/apps/rename-app-dialog.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

export function AppTitle() {
  const appId = useAppId();
  const app = useApp(appId);
  // Renaming changes the app, which waits for an identity.
  const renameable = useSessionIdentity() === SessionIdentity.Person;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="truncate font-medium text-base">{app.data?.name ?? appId}</h1>
      {renameable && app.data !== undefined && <RenameAppDialog name={app.data.name} />}
    </div>
  );
}

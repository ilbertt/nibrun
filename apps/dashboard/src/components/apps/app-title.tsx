import { RenameAppDialog } from '#components/apps/rename-app-dialog.tsx';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

export function AppTitle() {
  const appId = useAppId();
  const app = useApp(appId);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <h1 className="truncate font-medium text-base">{app.data?.name ?? appId}</h1>
      {app.data === undefined ? null : <RenameAppDialog name={app.data.name} />}
    </div>
  );
}

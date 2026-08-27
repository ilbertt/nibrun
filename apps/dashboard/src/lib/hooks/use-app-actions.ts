import { type AppActions, appActions } from '#lib/app-actions.ts';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';

/** What the action bar may offer for this app, which is what the app is doing read off the table. */
export function useAppActions(appId: string): AppActions {
  const app = useApp(appId);
  return appActions(useAppStatus(app.data).status);
}

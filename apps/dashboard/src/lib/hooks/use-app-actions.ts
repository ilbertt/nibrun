import { type AppActions, appActions, withoutIdentity } from '#lib/app-actions.ts';
import { useApp } from '#lib/hooks/use-app.ts';
import { useAppStatus } from '#lib/hooks/use-app-status.ts';
import { useIsAnonymous } from '#lib/hooks/use-is-anonymous.ts';

/** What the action bar may offer for this app, which is what the app is doing read off the table. */
export function useAppActions(appId: string): AppActions {
  const app = useApp(appId);
  const actions = appActions(useAppStatus(app.data).status);
  return useIsAnonymous() ? withoutIdentity(actions) : actions;
}

import { useRouterState } from '@tanstack/react-router';
import { Route as CronsRoute } from '#routes/(dashboard)/apps/$appId/crons.tsx';
import { Route as DomainsRoute } from '#routes/(dashboard)/apps/$appId/domains.tsx';
import { Route as FilesRoute } from '#routes/(dashboard)/apps/$appId/files.tsx';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export type AppTab = 'overview' | 'logs' | 'files' | 'crons' | 'domains';

export function useAppTab(): AppTab {
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });

  if (routeId === LogsRoute.id) {
    return 'logs';
  }
  if (routeId === FilesRoute.id) {
    return 'files';
  }
  if (routeId === DomainsRoute.id) {
    return 'domains';
  }
  if (routeId === CronsRoute.id) {
    return 'crons';
  }
  return 'overview';
}

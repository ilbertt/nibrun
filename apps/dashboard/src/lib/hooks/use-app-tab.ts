import { useRouterState } from '@tanstack/react-router';
import { Route as LogsRoute } from '#routes/(dashboard)/apps/$appId/logs.tsx';

export type AppTab = 'overview' | 'logs';

export function useAppTab(): AppTab {
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });

  if (routeId === LogsRoute.id) {
    return 'logs';
  }
  return 'overview';
}

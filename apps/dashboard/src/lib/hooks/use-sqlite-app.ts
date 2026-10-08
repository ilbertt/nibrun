import { useQuery } from '@tanstack/react-query';
import { type AppSummary, appQueryOptions } from '#queries/apps.ts';
import { Route } from '#routes/sqlite.tsx';

export function useSqliteApp(): AppSummary | undefined {
  const { appId } = Route.useSearch();
  return useQuery({
    ...appQueryOptions(appId ?? ''),
    enabled: Boolean(appId),
  }).data;
}

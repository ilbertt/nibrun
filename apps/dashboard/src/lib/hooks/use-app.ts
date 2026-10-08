import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type AppSummary, appQueryOptions } from '#queries/apps.ts';

export function useApp(appId: string | undefined): UseQueryResult<AppSummary, Error> {
  return useQuery({ ...appQueryOptions(appId ?? ''), enabled: appId !== undefined });
}

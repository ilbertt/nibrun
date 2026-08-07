import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type AppSummary, appsQueryOptions } from '#queries/apps.ts';

export function useApps(): UseQueryResult<AppSummary[], Error> {
  return useQuery(appsQueryOptions);
}

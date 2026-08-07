import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchApps() {
  return unwrap(await api.api.apps.get()).apps;
}

export type AppSummary = Awaited<ReturnType<typeof fetchApps>>[number];

export const appsQueryOptions = queryOptions({
  queryKey: ['apps'],
  queryFn: fetchApps,
});

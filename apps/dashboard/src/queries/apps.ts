import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchApps() {
  return unwrap(await api.api.apps.get()).apps;
}

async function fetchApp(appId: string) {
  return unwrap(await api.api.apps({ appId }).get());
}

export type AppSummary = Awaited<ReturnType<typeof fetchApp>>;

export const appsQueryOptions = queryOptions({
  queryKey: ['apps'],
  queryFn: fetchApps,
});

export function appQueryOptions(appId: string) {
  return queryOptions({
    queryKey: ['apps', appId],
    queryFn: () => fetchApp(appId),
  });
}

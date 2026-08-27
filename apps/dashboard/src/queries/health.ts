import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

const REFETCH_INTERVAL_MS = 5_000;

async function fetchHealth() {
  return unwrap(await api.api.health.get());
}

export type SystemHealth = Awaited<ReturnType<typeof fetchHealth>>;
export type SystemComponents = SystemHealth['components'];
export type ComponentName = keyof SystemComponents;

export const healthQueryOptions = queryOptions({
  queryKey: ['health'],
  queryFn: fetchHealth,
  refetchInterval: REFETCH_INTERVAL_MS,
});

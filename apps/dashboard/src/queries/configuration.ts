import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchConfiguration() {
  return unwrap(await api.api.configuration.get());
}

export const configurationQueryOptions = queryOptions({
  queryKey: ['configuration'],
  queryFn: fetchConfiguration,
  staleTime: Number.POSITIVE_INFINITY,
});

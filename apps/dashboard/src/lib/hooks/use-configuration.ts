import type { Configuration } from '@repo/api-client/models';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { configurationQueryOptions } from '#queries/configuration.ts';

export function useConfiguration(): UseQueryResult<Configuration, Error> {
  return useQuery(configurationQueryOptions);
}

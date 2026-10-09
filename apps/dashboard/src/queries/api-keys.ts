import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

export function apiKeysQueryOptions(ownerId: string) {
  return queryOptions({
    queryKey: ['api-keys', ownerId],
    queryFn: async () => {
      const { data, error } = await authClient.apiKey.list();
      if (error) {
        throw new Error(error.message);
      }
      return data.apiKeys;
    },
  });
}

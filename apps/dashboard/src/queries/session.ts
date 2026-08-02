import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

export const sessionQueryOptions = queryOptions({
  queryKey: ['session'],
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) {
      throw error;
    }
    return data;
  },
});

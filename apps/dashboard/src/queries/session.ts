import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

// The route guard primes this on navigation; without a window the components
// reading it would refetch what was just fetched.
const STALE_TIME_MS = 60_000;

export const sessionQueryOptions = queryOptions({
  staleTime: STALE_TIME_MS,
  queryKey: ['session'],
  queryFn: async () => {
    const { data, error } = await authClient.getSession();
    if (error) {
      throw error;
    }
    return data;
  },
});

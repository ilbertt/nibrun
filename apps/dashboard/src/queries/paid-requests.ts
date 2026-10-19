import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export const paidRequestsQueryOptions = queryOptions({
  queryKey: ['paid-requests'],
  queryFn: async function fetchPaidRequests() {
    return unwrap(await api.api['paid-requests'].get()).requests;
  },
});

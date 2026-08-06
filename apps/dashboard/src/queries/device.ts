import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

export const DEVICE_CODE_QUERY_KEY = 'device-code';

/**
 * Reading a pending code is also what claims it: the endpoint stamps the signed-in owner onto the
 * record, and approving one nobody has claimed is refused. So this runs before the buttons are
 * shown rather than being a lookup they could skip.
 */
export function deviceCodeQueryOptions(userCode: string) {
  return queryOptions({
    queryKey: [DEVICE_CODE_QUERY_KEY, userCode],
    queryFn: async () => {
      const { data, error } = await authClient.device({ query: { user_code: userCode } });
      if (error) {
        throw new Error(error.error_description ?? 'That code is not one we are waiting on.');
      }
      return data;
    },
    retry: false,
  });
}

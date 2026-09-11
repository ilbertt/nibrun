import { queryOptions } from '@tanstack/react-query';
import { authClient } from '#lib/auth.ts';

/**
 * Reading a pending code is also what claims it: the endpoint stamps the signed-in owner onto the
 * record, and approving one nobody has claimed is refused. So this runs before the buttons are
 * shown rather than being a lookup they could skip.
 *
 * Read once: the terminal redeems the code the moment it is answered and the record goes with it,
 * so a re-read past that point reports an invalid code, not the decision. What the page shows
 * after the claim comes from the owner's own click.
 */
export function deviceCodeQueryOptions(userCode: string) {
  return queryOptions({
    queryKey: ['device-code', userCode],
    queryFn: async () => {
      const { data, error } = await authClient.device({ query: { user_code: userCode } });
      if (error) {
        throw new Error(error.error_description ?? 'That code is not one we are waiting on.');
      }
      return data;
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

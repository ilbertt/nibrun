import { addDomain, removeDomain } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '#lib/api.ts';

export type AddedDomain = Awaited<ReturnType<typeof addDomain>>;

/**
 * Both invalidate the app rather than writing the new hostname into the cache: a domain arrives
 * `pending` and turns active on a clock neither this page nor the api controls, so the list is
 * refetched rather than reasoned about.
 *
 * Adding a domain the app already has is how it is asked about again, and that is said in a
 * toast because nothing on the page changes on its own account: the edge answers on its own time,
 * and the row turns active — or names what is still wrong — through the same refetch.
 */
export function useAddDomain(appId: string): UseMutationResult<AddedDomain, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostname: string) => addDomain({ api, appId, hostname }),
    onSuccess: (added) => {
      if (!added.created) {
        toast.success(saidAgain(added.hostname));
      }
      return queryClient.invalidateQueries({ queryKey: ['apps'] });
    },
  });
}

function saidAgain({ hostname, state }: AddedDomain['hostname']): string {
  return state === 'pending'
    ? `${hostname} will be checked again shortly.`
    : `${hostname} already answers.`;
}

export function useRemoveDomain(appId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostname: string) => removeDomain({ api, appId, hostname }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

import { addDomain, removeDomain } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export type AddedDomain = Awaited<ReturnType<typeof addDomain>>;

/**
 * Both invalidate the app rather than writing the new hostname into the cache: a domain arrives
 * `pending` and turns active on a clock neither this page nor the api controls, so the list is
 * refetched rather than reasoned about.
 */
export function useAddDomain(appId: string): UseMutationResult<AddedDomain, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostname: string) => addDomain({ api, appId, hostname }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

export function useRemoveDomain(appId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (hostname: string) => removeDomain({ api, appId, hostname }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

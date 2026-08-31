import { type ActivationEdit, setActivation } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export type ActivatedApp = Awaited<ReturnType<typeof setActivation>>;

/**
 * Only the app is invalidated, unlike suspending: no release is made and no microVM moves, so the
 * release beside it has nothing new to say. What the host does about it lands on the app's own
 * status the next time it reports.
 */
export function useAppActivation(
  appId: string,
): UseMutationResult<ActivatedApp, Error, ActivationEdit> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edit: ActivationEdit) => setActivation({ api, appId, edit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

import { type AppEdit, updateApp } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export type UpdatedApp = Awaited<ReturnType<typeof updateApp>>;

/** A patch of the app row and nothing after it — a release is `useDeploy`'s. */
export function useUpdateApp(appId: string): UseMutationResult<UpdatedApp, Error, AppEdit> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (edit: AppEdit) => updateApp({ api, appId, ...edit }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

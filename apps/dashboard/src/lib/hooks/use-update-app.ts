import { type AppEdit, updateApp } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import { useAppAnalytics } from '#lib/hooks/use-app-analytics.ts';

export type UpdatedApp = Awaited<ReturnType<typeof updateApp>>;

/** A patch of the app row and nothing after it — a release is `useDeploy`'s. */
export function useUpdateApp(appId: string): UseMutationResult<UpdatedApp, Error, AppEdit> {
  const queryClient = useQueryClient();
  const analytics = useAppAnalytics(appId);

  return useMutation({
    mutationFn: async (edit: AppEdit) => {
      const result = await updateApp({ api, appId, ...edit });
      analytics.settingsSaved({
        area: 'configuration',
        changed_fields: Object.keys(edit).sort().join(','),
      });
      return result;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apps'] }),
  });
}

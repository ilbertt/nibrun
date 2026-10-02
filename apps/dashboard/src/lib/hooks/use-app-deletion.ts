import { deleteApp } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '#lib/api.ts';
import { useAppAnalytics } from '#lib/hooks/use-app-analytics.ts';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';

export type DeletedApp = Awaited<ReturnType<typeof deleteApp>>;

export function useAppDeletion(appId: string): UseMutationResult<DeletedApp, Error, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const analytics = useAppAnalytics(appId);

  return useMutation({
    mutationFn: () => analytics.run({ action: 'delete', task: () => deleteApp({ api, appId }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      await navigate({ to: AppsRoute.to });
    },
  });
}

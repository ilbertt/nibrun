import { deleteApp } from '@repo/app-operations';
import { type UseMutationResult, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '#lib/api.ts';
import { Route as AppsRoute } from '#routes/(dashboard)/apps/index.tsx';

export type DeletedApp = Awaited<ReturnType<typeof deleteApp>>;

export function useAppDeletion(appId: string): UseMutationResult<DeletedApp, Error, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: () => deleteApp({ api, appId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['apps'] });
      await navigate({ to: AppsRoute.to });
    },
  });
}

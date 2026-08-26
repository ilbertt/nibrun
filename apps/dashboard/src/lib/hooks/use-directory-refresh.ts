import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppId } from '#lib/hooks/use-app-id.ts';
import { newestDeploymentQueryOptions } from '#queries/deployments.ts';
import { filesystemQueryKey } from '#queries/filesystem.ts';

export type DirectoryRefresh = {
  isRefreshing: boolean;
  refresh: () => void;
};

export function useDirectoryRefresh(): DirectoryRefresh {
  const appId = useAppId();
  const queryClient = useQueryClient();

  // Which deployment is current is half of what a listing means, so a refresh asks that again
  // first: entries read from a superseded deployment are stale in a way re-reading the same
  // deployment cannot fix.
  const refreshing = useMutation({
    mutationFn: async () => {
      await queryClient.invalidateQueries({
        queryKey: newestDeploymentQueryOptions(appId).queryKey,
      });
      await queryClient.invalidateQueries({ queryKey: filesystemQueryKey(appId) });
    },
  });

  return {
    isRefreshing: refreshing.isPending,
    refresh: () => refreshing.mutate(),
  };
}

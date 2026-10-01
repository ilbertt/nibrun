import { appStatus, operationRefusal } from '@repo/app-operations';
import type { CronListing } from '@repo/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '#lib/hooks/use-app.ts';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
import { appQueryOptions } from '#queries/apps.ts';
import { cronsQueryKey, cronsQueryOptions } from '#queries/crons.ts';
import { newestDeploymentQueryOptions } from '#queries/deployments.ts';

export type CronListingView = {
  listing: CronListing | undefined;
  deploymentId: string | undefined;
  reason: string | undefined;
  isRefreshing: boolean;
  refresh: () => void;
};

export function useCronListing(appId: string): CronListingView {
  const app = useApp(appId);
  const newest = useNewestDeployment(appId);
  const queryClient = useQueryClient();
  const refusal =
    app.data === undefined || !newest.isSuccess
      ? undefined
      : operationRefusal({
          operation: 'crons',
          name: app.data.name,
          release: newest.data,
          status: appStatus({
            appState: app.data.state,
            deploymentState: newest.data.state,
            instanceState: newest.data.instanceState,
          }),
        });
  const listing = useQuery(
    cronsQueryOptions({
      appId,
      deploymentId: app.data === undefined || refusal !== undefined ? undefined : newest.data?.id,
      appState: app.data?.state,
    }),
  );
  const refreshing = useMutation({
    mutationFn: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appQueryOptions(appId).queryKey }),
        queryClient.invalidateQueries({ queryKey: newestDeploymentQueryOptions(appId).queryKey }),
      ]);
      await queryClient.invalidateQueries({ queryKey: cronsQueryKey(appId) });
    },
  });
  const reason = app.error?.message ?? newest.error?.message ?? refusal ?? listing.error?.message;

  return {
    listing: reason === undefined ? listing.data : undefined,
    deploymentId: newest.data?.id,
    reason,
    isRefreshing: refreshing.isPending || app.isFetching || newest.isFetching || listing.isFetching,
    refresh: () => refreshing.mutate(),
  };
}

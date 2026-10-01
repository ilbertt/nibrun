import { readCrons } from '@repo/app-operations';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '#lib/api.ts';
import type { AppSummary } from '#queries/apps.ts';

export function cronsQueryKey(appId: string) {
  return ['crons', appId] as const;
}

export function cronsQueryOptions({
  appId,
  deploymentId,
  appState,
}: {
  appId: string;
  deploymentId: string | undefined;
  appState: AppSummary['state'] | undefined;
}) {
  return queryOptions({
    queryKey: [...cronsQueryKey(appId), deploymentId, appState],
    queryFn:
      deploymentId === undefined
        ? skipToken
        : ({ signal }) => readCrons({ api, appId, deploymentId, signal }),
    retry: false,
    refetchOnMount: 'always',
  });
}

import { followLogs } from '@repo/app-operations';
import type { LogTimerange, TenantLogRecord } from '@repo/protocol';
import {
  queryOptions,
  skipToken,
  experimental_streamedQuery as streamedQuery,
} from '@tanstack/react-query';
import { api } from '#lib/api.ts';

const KEPT_RECORDS = 2_000;

function keptTail(records: readonly TenantLogRecord[]): readonly TenantLogRecord[] {
  return records.length > KEPT_RECORDS ? records.slice(-KEPT_RECORDS) : records;
}

export function deploymentLogsQueryOptions({
  appId,
  deploymentId,
  timerange,
}: {
  appId: string;
  deploymentId: string | undefined;
  timerange: LogTimerange;
}) {
  return queryOptions({
    queryKey: ['deployments', appId, deploymentId, 'logs', timerange],
    queryFn:
      deploymentId === undefined
        ? skipToken
        : streamedQuery<TenantLogRecord, readonly TenantLogRecord[]>({
            streamFn: ({ signal }) =>
              followLogs({
                api,
                appId,
                deploymentId,
                timerange,
                signal,
              }),
            // biome-ignore lint/complexity/useMaxParams: a reducer folds a chunk into what it has
            reducer: (seen, record) => keptTail([...seen, record]),
            initialValue: [],
          }),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

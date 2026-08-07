import { readDirectory } from '@repo/app-operations';
import type { GuestPath } from '@repo/protocol';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

export type DirectoryTarget = {
  appId: string;
  deploymentId: string | undefined;
  path: GuestPath | undefined;
};

export function directoryQueryOptions({ appId, deploymentId, path }: DirectoryTarget) {
  return queryOptions({
    queryKey: ['filesystem', appId, deploymentId, path],
    queryFn:
      deploymentId === undefined || path === undefined
        ? skipToken
        : () => readDirectory({ api, appId, deploymentId, path }),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

import { guestPath } from '@repo/app-operations';
import type { DirectoryListing, GuestPath } from '@repo/protocol';
import { useQuery } from '@tanstack/react-query';
import { useLatestDeployment } from '#lib/hooks/use-latest-deployment.ts';
import { directoryQueryOptions } from '#queries/filesystem.ts';

export type DirectoryListingView = {
  status: 'loading' | 'ready' | 'failed';
  listing: DirectoryListing | undefined;
  deploymentId: string | undefined;
  reason: string | undefined;
};

export type DirectoryListingInput = {
  appId: string;
  typedPath: string;
};

export function useDirectoryListing({
  appId,
  typedPath,
}: DirectoryListingInput): DirectoryListingView {
  const latest = useLatestDeployment(appId);
  const parsed = parsePath(typedPath);
  const listing = useQuery(
    directoryQueryOptions({ appId, deploymentId: latest.data, path: parsed.path }),
  );

  if (parsed.reason !== undefined) {
    return {
      status: 'failed',
      listing: undefined,
      deploymentId: undefined,
      reason: parsed.reason,
    };
  }
  if (latest.isError) {
    return {
      status: 'failed',
      listing: undefined,
      deploymentId: undefined,
      reason: latest.error.message,
    };
  }
  if (listing.isError) {
    return {
      status: 'failed',
      listing: undefined,
      deploymentId: latest.data,
      reason: listing.error.message,
    };
  }
  if (listing.data === undefined) {
    return {
      status: 'loading',
      listing: undefined,
      deploymentId: latest.data,
      reason: undefined,
    };
  }
  return {
    status: 'ready',
    listing: listing.data,
    deploymentId: latest.data,
    reason: undefined,
  };
}

type ParsedPath = { path: GuestPath; reason?: undefined } | { path?: undefined; reason: string };

function parsePath(typed: string): ParsedPath {
  try {
    return { path: guestPath(typed) };
  } catch (failure) {
    return { reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

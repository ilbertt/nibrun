import { useQuery } from '@tanstack/react-query';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
import { artifactQueryOptions } from '#queries/artifacts.ts';

/**
 * The binary an app is running, by the name it was uploaded under. `unknown` covers an app that
 * has never been deployed as well as one whose artifact could not be read — neither leaves
 * anything to name, and there is nothing an owner would do differently about which it was.
 */
export type DeployedBinary =
  | { readonly status: 'loading' }
  | { readonly status: 'unknown' }
  | { readonly status: 'ready'; readonly name: string };

const LOADING: DeployedBinary = { status: 'loading' };
const UNKNOWN: DeployedBinary = { status: 'unknown' };

export function useDeployedBinary(appId: string): DeployedBinary {
  const newest = useNewestDeployment(appId);
  const artifact = useQuery(artifactQueryOptions({ appId, artifactId: newest.data?.artifactId }));

  if (newest.isError || artifact.isError) {
    return UNKNOWN;
  }
  return artifact.data === undefined
    ? LOADING
    : { status: 'ready', name: artifact.data.originalFileName };
}

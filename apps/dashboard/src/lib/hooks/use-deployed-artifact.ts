import type { Artifact } from '@repo/api-client/models';
import { useQuery } from '@tanstack/react-query';
import { useNewestDeployment } from '#lib/hooks/use-newest-deployment.ts';
import { artifactQueryOptions } from '#queries/artifacts.ts';

/**
 * The artifact pinned by the latest deployment. `unknown` covers an app that
 * has never been deployed as well as one whose artifact could not be read — neither leaves
 * anything to name, and there is nothing an owner would do differently about which it was.
 */
export type DeployedArtifact =
  | { readonly status: 'loading' }
  | { readonly status: 'unknown' }
  | { readonly status: 'ready'; readonly artifact: Artifact };

const LOADING: DeployedArtifact = { status: 'loading' };
const UNKNOWN: DeployedArtifact = { status: 'unknown' };

export function useDeployedArtifact(appId: string): DeployedArtifact {
  const newest = useNewestDeployment(appId);
  const artifact = useQuery(artifactQueryOptions({ appId, artifactId: newest.data?.artifactId }));

  if (newest.isError || artifact.isError) {
    return UNKNOWN;
  }
  return artifact.data === undefined
    ? LOADING
    : {
        status: 'ready',
        artifact: artifact.data,
      };
}

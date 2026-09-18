import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { type ArtifactSummary, artifactsQueryOptions } from '#queries/artifacts.ts';

export function useArtifacts(appId: string): UseQueryResult<ArtifactSummary[], Error> {
  return useQuery(artifactsQueryOptions(appId));
}

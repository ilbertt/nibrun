import { unwrap } from '@repo/api-client/unwrap';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '#lib/api.ts';

async function fetchArtifact({ appId, artifactId }: { appId: string; artifactId: string }) {
  return unwrap(await api.api.apps({ appId }).artifacts({ artifactId }).get());
}

export type ArtifactSummary = Awaited<ReturnType<typeof fetchArtifact>>;

export function artifactQueryOptions({
  appId,
  artifactId,
}: {
  appId: string;
  artifactId: string | undefined;
}) {
  return queryOptions({
    queryKey: ['apps', appId, 'artifacts', artifactId],
    queryFn: artifactId === undefined ? skipToken : () => fetchArtifact({ appId, artifactId }),
  });
}

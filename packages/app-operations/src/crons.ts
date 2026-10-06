import type { CronListing } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';

export async function readCrons({
  api,
  appId,
  deploymentId,
  signal,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
  signal: AbortSignal | undefined;
}): Promise<CronListing> {
  return unwrap(
    await api.api.apps({ appId }).deployments({ deploymentId }).crons.get({ fetch: { signal } }),
  );
}

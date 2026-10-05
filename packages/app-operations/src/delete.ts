import type { AppState } from '@repo/api/lib/api/app';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';

/**
 * Delete an app: the hostnames it answered on, everything its binary ever wrote, every deployment
 * of it, and — once the api has torn it down — every binary uploaded to it and every export taken
 * of it.
 */
export async function deleteApp({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<{ name: string; state: AppState }> {
  return unwrap(await api.api.apps({ appId }).delete());
}

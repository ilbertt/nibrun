import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { type AppEdit, configPatch } from '#release.ts';

export type UpdateInput = AppEdit & { api: PublicApiClient; appId: string };

/**
 * Change what the app is called or how it starts, and nothing else: no release is made, so a
 * config edit here waits for the next one. `redeploy` is the same patch followed by a release.
 */
export async function updateApp({ api, appId, name, ...edit }: UpdateInput) {
  const app = api.api.apps({ appId });
  const changes = configPatch(edit);
  const rename = name === undefined ? {} : { name };
  if (Object.keys(changes).length === 0) {
    return unwrap(await app.patch(rename));
  }
  return unwrap(await app.patch({ ...rename, config: changes }));
}

import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import type { AppState, OwnedAppState } from '@repo/protocol';

type OwnedApp = { api: PublicApiClient; appId: string };

type SuspendedApp = { slug: string; state: AppState };

/**
 * Take the app offline and keep everything it wrote: the microVM stops, the volume and every byte
 * on it stay, and the hostnames stay issued. What comes back is the release that went away, so
 * this costs an app its uptime and nothing else.
 */
export function suspendApp({ api, appId }: OwnedApp): Promise<SuspendedApp> {
  return setState({ api, appId, state: 'suspended' });
}

/** Put it back: the host boots the deployment the app was suspended on, onto the same volume. */
export function resumeApp({ api, appId }: OwnedApp): Promise<SuspendedApp> {
  return setState({ api, appId, state: 'active' });
}

async function setState({
  api,
  appId,
  state,
}: OwnedApp & { state: OwnedAppState }): Promise<SuspendedApp> {
  return unwrap(await api.api.apps({ appId }).state.put({ state }));
}

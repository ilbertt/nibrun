import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import { appFor, pinnedArtifact } from '#apps.ts';
import { type AppEdit, type Deployed, type DeployStep, servingHostname } from '#release.ts';
import { updateApp } from '#update.ts';

const NOTHING_TO_RELEASE = 'This app has never been deployed.';

export type RedeployInput = AppEdit & {
  api: PublicApiClient;
  app: string;
  onStep?: ((step: DeployStep) => void) | undefined;
};

/**
 * Release the binary the app is already running, with whatever this changes about how it starts.
 *
 * The bytes are in the store from the deploy that put them there, so an owner changing a variable
 * or an argument is not asked for the binary a second time — the app is reconfigured and the same
 * artifact is released against it.
 *
 * Which artifact that is gets read before the config is written: an app that has never been
 * deployed has no binary to run again, and finding that out afterwards would leave it configured
 * for a release nobody made.
 */
export async function redeploy({ api, app, onStep, ...edit }: RedeployInput): Promise<Deployed> {
  const target = await appFor({ api, name: app, operation: 'release' });
  if (!target.newest) {
    throw new ApiError(NOTHING_TO_RELEASE);
  }
  const artifact = await pinnedArtifact({
    api,
    appId: target.app.id,
    artifactId: target.newest.artifactId,
  });

  const patched = await updateApp({ api, appId: target.app.id, ...edit });
  onStep?.({ kind: 'app', appId: patched.id, name: patched.name });
  onStep?.({ kind: 'artifact', artifactId: artifact.id, digest: artifact.digest });

  const deployment = unwrap(
    await api.api.apps({ appId: patched.id }).deployments.post({ artifactId: artifact.id }),
  );
  onStep?.({ kind: 'deployment', deploymentId: deployment.id });

  return {
    appId: patched.id,
    name: patched.name,
    deploymentId: deployment.id,
    url: `https://${servingHostname(patched.hostnames)}`,
  };
}

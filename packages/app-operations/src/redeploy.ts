import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { currentArtifact, releaseTarget } from '#apps.ts';
import {
  type ConfigEdit,
  configPatch,
  type Deployed,
  type DeployStep,
  servingHostname,
} from '#release.ts';

export type RedeployInput = ConfigEdit & {
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
export async function redeploy({
  api,
  app: slug,
  onStep,
  ...edit
}: RedeployInput): Promise<Deployed> {
  const target = await releaseTarget({ api, slug });
  const artifact = await currentArtifact({ api, appId: target.id });

  const app = unwrap(await api.api.apps({ appId: target.id }).patch(configPatch(edit)));
  onStep?.({ kind: 'app', appId: app.id, slug: app.slug });
  onStep?.({ kind: 'artifact', artifactId: artifact.id, digest: artifact.digest });

  const deployment = unwrap(
    await api.api.apps({ appId: app.id }).deployments.post({ artifactId: artifact.id }),
  );
  onStep?.({ kind: 'deployment', deploymentId: deployment.id });

  return {
    appId: app.id,
    slug: app.slug,
    deploymentId: deployment.id,
    url: `https://${servingHostname(app.hostnames)}`,
  };
}

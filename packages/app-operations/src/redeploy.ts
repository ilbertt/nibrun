import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import { AppNameSchema, Value } from '@repo/protocol';
import { appFor, pinnedArtifact } from '#apps.ts';
import {
  type ConfigEdit,
  configPatch,
  type Deployed,
  type DeployStep,
  servingHostname,
} from '#release.ts';

const NOTHING_TO_RELEASE = 'This app has never been deployed.';

export type RedeployInput = ConfigEdit & {
  api: PublicApiClient;
  app: string;
  /** What to call the app from now on. Its hostnames stay: the slug never follows a rename. */
  name?: string | undefined;
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
  app,
  name,
  onStep,
  ...edit
}: RedeployInput): Promise<Deployed> {
  const target = await appFor({ api, name: app, operation: 'release' });
  if (!target.newest) {
    throw new ApiError(NOTHING_TO_RELEASE);
  }
  const artifact = await pinnedArtifact({
    api,
    appId: target.app.id,
    artifactId: target.newest.artifactId,
  });

  // Parsed here rather than passed through, for the reason a domain is: a name the api would
  // refuse is refused by the caller that took it rather than by a round trip.
  const patched = unwrap(
    await api.api.apps({ appId: target.app.id }).patch({
      ...configPatch(edit),
      ...(name !== undefined && { name: Value.Parse(AppNameSchema, name) }),
    }),
  );
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

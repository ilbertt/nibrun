import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import type { SettledDeployment } from '#deploy.ts';

const NO_DEPLOYMENTS = 'This app has never been deployed.';

// Apps are addressed by id and listed by slug; the slug is the half a person sees, so it is the
// half the CLI takes and this is where the two meet.
export async function appBySlug({ api, slug }: { api: PublicApiClient; slug: string }) {
  const { apps } = unwrap(await api.api.apps.get());
  const found = apps.find((app) => app.slug === slug);
  if (!found) {
    throw new ApiError(`No app with slug ${slug}.`);
  }
  return found;
}

/**
 * The release the app is on: the one a reader means by not naming one, and the only one that says
 * what the app is doing now. The api lists them newest first, so this is the head of the list
 * rather than a search through it.
 */
export async function newestDeployment({ api, appId }: { api: PublicApiClient; appId: string }) {
  const { deployments } = unwrap(await api.api.apps({ appId }).deployments.get());
  const newest = deployments[0];
  if (!newest) {
    throw new ApiError(NO_DEPLOYMENTS);
  }
  return newest;
}

/**
 * The binary the app is running, read back off the release that pinned it.
 *
 * An artifact rather than the id the deployment carries: what a caller does with this is release
 * it again, and the digest is the only thing that says which binary that is.
 */
export async function currentArtifact({ api, appId }: { api: PublicApiClient; appId: string }) {
  const { artifactId } = await newestDeployment({ api, appId });
  return unwrap(await api.api.apps({ appId }).artifacts({ artifactId }).get());
}

export type AddressedDeployment = {
  appId: string;
  deploymentId: string;
  slug: string;
  /**
   * The release the app is on, which is a different question from the one addressed: naming an
   * older deployment addresses a release that has been replaced, not the one running now.
   */
  newest: SettledDeployment;
};

/**
 * The deployment a command was pointed at, and the release the app is actually on.
 *
 * The app is looked up either way — a deployment is addressed under the app that owns it — and so
 * is the newest release, even when naming one made it unnecessary to ask which that is: whether
 * anything is running is a question about the app rather than about the deployment addressed, and
 * it is the answer to that one that decides whether a command can do anything at all.
 */
export async function addressedDeployment({
  api,
  slug,
  deploymentId,
}: {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
}): Promise<AddressedDeployment> {
  const app = await appBySlug({ api, slug });
  const newest = await newestDeployment({ api, appId: app.id });
  return {
    appId: app.id,
    deploymentId: deploymentId ?? newest.id,
    slug: app.slug,
    newest,
  };
}

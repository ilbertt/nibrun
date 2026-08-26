import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';

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
 * The deployment a reader means by not naming one. The api lists them newest first, so this is
 * the head of the list rather than a search through it.
 */
export async function latestDeployment({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<string> {
  return (await newestDeployment({ api, appId })).id;
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

async function newestDeployment({ api, appId }: { api: PublicApiClient; appId: string }) {
  const { deployments } = unwrap(await api.api.apps({ appId }).deployments.get());
  const newest = deployments[0];
  if (!newest) {
    throw new ApiError(NO_DEPLOYMENTS);
  }
  return newest;
}

/**
 * The deployment a command was pointed at.
 *
 * The app is looked up either way — a deployment is addressed under the app that owns it — so
 * what naming one skips is only the question of which deployment is current.
 */
export async function addressedDeployment({
  api,
  slug,
  deploymentId,
}: {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
}): Promise<{ appId: string; deploymentId: string; slug: string }> {
  const app = await appBySlug({ api, slug });
  const addressed = deploymentId ?? (await latestDeployment({ api, appId: app.id }));
  return { appId: app.id, deploymentId: addressed, slug: app.slug };
}

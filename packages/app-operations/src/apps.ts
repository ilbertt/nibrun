import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import type { SettledDeployment } from '#deploy.ts';
import { type AppOperation, operationRefusal } from '#operations.ts';
import { type AppStatus, appStatus } from '#status.ts';

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
 * One app exactly as the api answers with it, for a surface that renders one: every field is the
 * api's to name, so anything restating the shape here would be a second place for it to be wrong.
 */
export type ListedApp = Awaited<ReturnType<typeof appBySlug>>;

/**
 * The app and what it is doing: the row is what its owner asked for and the newest release is what
 * a host has done about it, and no command can tell what it may do from either alone.
 */
export async function appWithStatus({ api, slug }: { api: PublicApiClient; slug: string }) {
  const app = await appBySlug({ api, slug });
  const { deployments } = unwrap(await api.api.apps({ appId: app.id }).deployments.get());
  const newest = deployments[0];
  return {
    app,
    newest,
    status: appStatus({ appState: app.state, deploymentState: newest?.state }),
  };
}

/**
 * The app a command may act on, and the release it is on, refused where the state it is in has an
 * answer of its own — which is asked before anything is sent and before anything is waited on.
 *
 * A deploy is the reason this reads the release as well as the row: a host is only sent releases
 * whose app is asking to run, so one made onto a suspended app would sit pending until it is
 * resumed rather than fail, and the refusal has to arrive before the binary does.
 */
export async function appFor({
  api,
  slug,
  operation,
}: {
  api: PublicApiClient;
  slug: string;
  operation: AppOperation;
}) {
  const found = await appWithStatus({ api, slug });
  const refusal = operationRefusal({
    status: found.status,
    operation,
    slug: found.app.slug,
    release: found.newest,
  });
  if (refusal !== undefined) {
    throw new ApiError(refusal);
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
 * The binary a release pinned, which is what releasing it again means: the digest is the only
 * thing that says which binary that is.
 */
export async function pinnedArtifact({
  api,
  appId,
  artifactId,
}: {
  api: PublicApiClient;
  appId: string;
  artifactId: string;
}) {
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
  /** What the app is doing, which is what decides whether the command asking may do anything. */
  status: AppStatus;
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
  operation,
}: {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
  operation: AppOperation;
}): Promise<AddressedDeployment> {
  const { app, newest, status } = await appFor({ api, slug, operation });
  if (!newest) {
    throw new ApiError(NO_DEPLOYMENTS);
  }
  return {
    appId: app.id,
    deploymentId: deploymentId ?? newest.id,
    slug: app.slug,
    newest,
    status,
  };
}

import {
  type AppOperation,
  type AppStatus,
  appStatus,
  operationRefusal,
} from '@repo/app-operations';
import type { OwnerId } from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type { McpServices } from '#lib/mcp/services.ts';
import type { PublicApp } from '#services/apps.service.ts';
import type { PublicDeployment } from '#services/deployments.service.ts';

const NO_DEPLOYMENTS = 'This app has never been deployed.';

type Asking = { services: McpServices; ownerId: OwnerId; slug: string };

/**
 * The app a slug names.
 *
 * Apps are addressed by id and listed by slug; the slug is the half a person sees, so it is the
 * half the tools take and this is where the two meet. A listing scoped to the owner is also what
 * makes a slug they do not own indistinguishable from one that does not exist.
 */
export async function appBySlug({ services, ownerId, slug }: Asking): Promise<PublicApp> {
  const apps = await services.apps.list({ ownerId });
  const found = apps.find((app) => app.slug === slug);
  if (!found) {
    throw new NotFoundError(`No app with slug ${slug}.`);
  }
  return found;
}

export type AppAndRelease = {
  app: PublicApp;
  /** Absent for an app nobody has deployed, which no release can say anything about. */
  newest: PublicDeployment | undefined;
  status: AppStatus;
};

/**
 * The app and what it is doing: the row is what its owner asked for and the newest release is what
 * a host has done about it, and no tool can tell what it may do from either alone.
 */
export async function appWithStatus(asking: Asking): Promise<AppAndRelease> {
  const app = await appBySlug(asking);
  const deployments = await asking.services.deployments.list({
    appId: app.id,
    ownerId: asking.ownerId,
  });
  const newest = deployments[0];
  return {
    app,
    newest,
    status: appStatus({ appState: app.state, deploymentState: newest?.state }),
  };
}

/**
 * The app a tool may act on, refused where the state it is in has an answer of its own — which is
 * asked before anything is written and before anything is waited on.
 *
 * A deploy is the reason this reads the release as well as the row: a host is only sent releases
 * whose app is asking to run, so one made onto a suspended app would sit pending until it is
 * resumed rather than fail, and the refusal has to arrive before the binary does.
 */
export async function appFor(asking: Asking & { operation: AppOperation }): Promise<AppAndRelease> {
  const found = await appWithStatus(asking);
  const refusal = operationRefusal({
    status: found.status,
    operation: asking.operation,
    slug: found.app.slug,
    release: found.newest,
  });
  if (refusal !== undefined) {
    throw new ConflictError(refusal);
  }
  return found;
}

/** The release the app is on, which is the one a reader means by not naming one. */
export async function releaseOf(asking: Asking & { operation: AppOperation }) {
  const found = await appFor(asking);
  if (!found.newest) {
    throw new NotFoundError(NO_DEPLOYMENTS);
  }
  return { ...found, newest: found.newest };
}

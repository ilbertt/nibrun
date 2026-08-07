import type { Print } from '@parshjs/core';
import { APP_OPTION } from '#config.ts';
import { type Api, unwrap } from '#lib/api.ts';
import { ApiError, UsageError } from '#lib/errors.ts';

const NO_APP_NAMED = `Which app? Name one with --${APP_OPTION}.`;
const NO_DEPLOYMENTS = 'This app has never been deployed.';

/**
 * `--app` is optional on `apps` so that asking for nothing is answered with a listing rather
 * than an error, which leaves every command underneath to say what going without one means. They
 * all mean the same thing, so they say it from here.
 */
export function requireAppSlug(slug: string | undefined): string {
  if (slug === undefined) {
    throw new UsageError(NO_APP_NAMED);
  }
  return slug;
}

// Apps are addressed by id and listed by slug; the slug is the half a person sees, so it is the
// half the CLI takes and this is where the two meet.
export async function appBySlug({ api, slug }: { api: Api; slug: string }) {
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
async function latestDeployment({ api, appId }: { api: Api; appId: string }): Promise<string> {
  const { deployments } = unwrap(await api.api.apps({ appId }).deployments.get());
  const newest = deployments[0];
  if (!newest) {
    throw new ApiError(NO_DEPLOYMENTS);
  }
  return newest.id;
}

/**
 * The deployment a command was pointed at, and a line saying which one it turned out to be.
 *
 * The app is looked up either way — a deployment is addressed under the app that owns it — so
 * what naming one skips is only the question of which deployment is current. Which makes the line
 * worth printing: the answer to that question is the difference between reading the release
 * someone just made and reading the one before it.
 */
export async function addressedDeployment({
  api,
  slug,
  deploymentId,
  print,
}: {
  api: Api;
  slug: string;
  deploymentId: string | undefined;
  print: Print;
}): Promise<{ appId: string; deploymentId: string }> {
  const app = await appBySlug({ api, slug });
  const addressed = deploymentId ?? (await latestDeployment({ api, appId: app.id }));
  print.dim(`${app.slug} · deployment ${addressed}`);
  return { appId: app.id, deploymentId: addressed };
}

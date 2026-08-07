import { select } from '@clack/prompts';
import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import { SHARED_OPTIONS } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

const NO_APP_NAMED = `Which app? Name one with --${SHARED_OPTIONS.app.name}.`;
export const NO_APPS = 'You have no apps. `nib run` is what makes one.';
const NO_DEPLOYMENTS = 'This app has never been deployed.';

/**
 * The app a command was pointed at: the flag when it was given, and the question it stands for
 * when it was not.
 *
 * `--app` is optional on `apps` so that asking for nothing is answered with a listing rather
 * than an error, which leaves every command underneath to say what going without one means. They
 * all mean the same thing, so they say it from here.
 */
export async function selectApp({
  api,
  slug,
  interactive,
}: {
  api: PublicApiClient;
  slug: string | undefined;
  interactive: boolean;
}): Promise<string> {
  if (slug !== undefined) {
    return slug;
  }
  if (!interactive) {
    throw new UsageError(NO_APP_NAMED);
  }
  return await chooseApp({ api });
}

/**
 * A slug rather than the app it was read from, even though whatever the answer is handed to reads
 * the listing again: a slug is what an owner calls an app by and what every command under `apps`
 * takes, and the second read falls only on somebody already sat at the prompt.
 */
async function chooseApp({ api }: { api: PublicApiClient }): Promise<string> {
  const { apps } = unwrap(await api.api.apps.get());
  if (apps.length === 0) {
    throw new UsageError(NO_APPS);
  }
  const chosen = await select({
    message: 'Which app?',
    options: apps.map((app) => ({
      value: app.slug,
      label: app.slug,
      // Every app the api lists is offered — reading what a suspended one wrote is a reason to
      // have kept it — so the state is said as well, an app being torn down answering differently
      // and having chosen it being too late to find that out.
      hint: app.state === 'active' ? undefined : app.state,
    })),
  });
  return answered(chosen);
}

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
async function latestDeployment({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<string> {
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
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
  print: Print;
}): Promise<{ appId: string; deploymentId: string }> {
  const app = await appBySlug({ api, slug });
  const addressed = deploymentId ?? (await latestDeployment({ api, appId: app.id }));
  print.dim(`${app.slug} · deployment ${addressed}`);
  return { appId: app.id, deploymentId: addressed };
}

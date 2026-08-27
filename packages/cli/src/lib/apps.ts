import { select } from '@clack/prompts';
import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import {
  type AddressedDeployment,
  type AppOperation,
  addressedDeployment,
  isRunning,
} from '@repo/app-operations';
import { SHARED_OPTIONS } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

const NO_APP_NAMED = `Which app? Name one with --${SHARED_OPTIONS.app.name}.`;
export const NO_APPS = 'You have no apps. `nib run` is what makes one.';

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

/**
 * The deployment a command was pointed at, and a line saying which one it turned out to be.
 *
 * The line is worth printing because naming no deployment is a question rather than a default, and
 * its answer is the difference between reading the release someone just made and reading the one
 * before it.
 */
export async function announcedDeployment({
  api,
  slug,
  deploymentId,
  operation,
  print,
}: {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
  operation: AppOperation;
  print: Print;
}): Promise<AddressedDeployment> {
  const addressed = await addressedDeployment({ api, slug, deploymentId, operation });
  print.dim(`${addressed.slug} · deployment ${addressed.deploymentId}`);
  return addressed;
}

/**
 * Whether anything is still to arrive on this deployment's output: the app running, on the very
 * release named. Following the one it has moved off is a wait for nothing, however busy it is.
 */
export function stillWriting(addressed: AddressedDeployment): boolean {
  return isRunning(addressed.status) && addressed.deploymentId === addressed.newest.id;
}

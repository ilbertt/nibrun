import { select } from '@clack/prompts';
import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import {
  type AddressedDeployment,
  type AppOperation,
  addressedDeployment,
  hasLiveOutput,
} from '@repo/app-operations';
import { SHARED_OPTIONS } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

const NO_APP_NAMED = `Which app? Name one with --${SHARED_OPTIONS.app.name}.`;
export const NO_APPS = 'You have no apps. `nib run` is what makes one.';

/** An app as `--app` resolves to: the id the api is asked by, and the name to say it by. */
export type AddressedApp = { id: string; name: string };

type ListedApp = AddressedApp & { slug: string; state: string };

/**
 * The app a command was pointed at: the flag when it was given, and the question it stands for
 * when it was not.
 *
 * Resolved to an id here, once, because a name is what an owner calls an app and two of theirs
 * may share one — the id is the api's, and only ever one app's. Where the name matches more than
 * one the owner is asked which, or told to say which by slug where there is nobody to ask; a slug
 * is taken in the flag's place because it is the answer to that.
 *
 * `--app` is optional on `apps` so that asking for nothing is answered with a listing rather
 * than an error, which leaves every command underneath to say what going without one means. They
 * all mean the same thing, so they say it from here.
 */
export async function selectApp({
  api,
  name,
  interactive,
}: {
  api: PublicApiClient;
  name: string | undefined;
  interactive: boolean;
}): Promise<AddressedApp> {
  if (name === undefined && !interactive) {
    throw new UsageError(NO_APP_NAMED);
  }
  const { apps } = unwrap(await api.api.apps.get());
  if (name !== undefined) {
    return resolveApp({ apps, name, interactive });
  }
  if (apps.length === 0) {
    throw new UsageError(NO_APPS);
  }
  return chooseApp({ apps, message: 'Which app?' });
}

function resolveApp({
  apps,
  name,
  interactive,
}: {
  apps: readonly ListedApp[];
  name: string;
  interactive: boolean;
}): Promise<AddressedApp> {
  const named = apps.filter((app) => app.name === name);
  const [only] = named;
  if (only !== undefined && named.length === 1) {
    return Promise.resolve(addressed(only));
  }
  if (named.length > 1) {
    if (!interactive) {
      throw new UsageError(
        `${named.length} apps are named ${name}. Say which by its slug: ${named.map((app) => app.slug).join(', ')}.`,
      );
    }
    return chooseApp({ apps: named, message: `Which ${name}?` });
  }
  const bySlug = apps.find((app) => app.slug === name);
  if (bySlug !== undefined) {
    return Promise.resolve(addressed(bySlug));
  }
  throw new UsageError(`No app named ${name}.`);
}

/**
 * Every app offered is offered with its slug, because that is what tells two of one name apart —
 * and with its state where that is anything but running: reading what a suspended one wrote is a
 * reason to have kept it, but an app being torn down answers differently, and having chosen it is
 * too late to find that out.
 */
async function chooseApp({
  apps,
  message,
}: {
  apps: readonly ListedApp[];
  message: string;
}): Promise<AddressedApp> {
  const chosen = await select({
    message,
    options: apps.map((app) => ({
      value: app.id,
      label: app.name,
      hint: app.state === 'active' ? app.slug : `${app.slug} · ${app.state}`,
    })),
  });
  const id = answered(chosen);
  const app = apps.find((each) => each.id === id);
  if (app === undefined) {
    throw new Error('The prompt answered with an app it was not offered.');
  }
  return addressed(app);
}

function addressed({ id, name }: ListedApp): AddressedApp {
  return { id, name };
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
  appId,
  deploymentId,
  operation,
  print,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string | undefined;
  operation: AppOperation;
  print: Print;
}): Promise<AddressedDeployment> {
  const found = await addressedDeployment({ api, appId, deploymentId, operation });
  print.dim(`${found.name} · deployment ${found.deploymentId}`);
  return found;
}

/**
 * Whether anything is still to arrive on this deployment's output: the app running, on the very
 * release named. Following the one it has moved off is a wait for nothing, however busy it is.
 */
export function stillWriting(addressed: AddressedDeployment): boolean {
  return hasLiveOutput(addressed.status) && addressed.deploymentId === addressed.newest.id;
}

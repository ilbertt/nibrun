import type { PublicApiClient } from '@repo/api-client/public';
import {
  appBySlug,
  resumeApp as requestResume,
  suspendApp as requestSuspension,
} from '@repo/app-operations';
import { UsageError } from '#lib/errors.ts';
import type { Ui } from '#lib/ui.ts';

export type SuspendInput = { api: PublicApiClient; slug: string; ui: Ui };

/**
 * Take an app offline without giving anything of it up. Nothing here is destructive and there is
 * nothing to confirm: what a suspended app costs is its uptime, and resuming is the undo.
 */
export async function suspendApp({ api, slug, ui }: SuspendInput): Promise<void> {
  const app = await liveApp({ api, slug });
  if (app.state === 'suspended') {
    ui.done(`${app.slug} is already suspended.`);
    return;
  }

  const suspended = await requestSuspension({ api, appId: app.id });
  ui.done(
    `${suspended.slug} is suspended. Its microVM stops; the volume, everything on it and every hostname stay.`,
  );
}

export async function resumeApp({ api, slug, ui }: SuspendInput): Promise<void> {
  const app = await liveApp({ api, slug });
  if (app.state === 'active') {
    ui.done(`${app.slug} is already running.`);
    return;
  }

  const resumed = await requestResume({ api, appId: app.id });
  ui.done(`${resumed.slug} is active. The host boots the deployment it was suspended on.`);
}

/**
 * An app is looked up here either way — a slug is what an owner types and an id is what the api
 * takes — so a teardown already running is answered from what that read said rather than by
 * sending a request the api would refuse.
 */
async function liveApp({ api, slug }: Omit<SuspendInput, 'ui'>) {
  const app = await appBySlug({ api, slug });
  if (app.state === 'deleting' || app.state === 'deleted') {
    throw new UsageError(`${app.slug} is being deleted, and there is no way back out of that.`);
  }
  return app;
}

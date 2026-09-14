import type { PublicApiClient } from '@repo/api-client/public';
import {
  appFor,
  resumeApp as requestResume,
  suspendApp as requestSuspension,
} from '@repo/app-operations';
import { APP_STATES } from '@repo/protocol';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';

/** Where the app was left, and whether this run is what put it there. */
const AppStateChangeSchema = z.object({
  name: z.string(),
  state: z.enum(APP_STATES),
  changed: z.boolean(),
});

export type AppStateChange = z.infer<typeof AppStateChangeSchema>;

export const SUSPENDED_OUTPUT = defineOutput({
  schema: AppStateChangeSchema,
  render: ({ value, out }) =>
    out.done(
      value.changed
        ? `${value.name} is suspended. Its microVM stops; the volume, everything on it and every hostname stay.`
        : `${value.name} is already suspended.`,
    ),
});

export const RESUMED_OUTPUT = defineOutput({
  schema: AppStateChangeSchema,
  render: ({ value, out }) =>
    out.done(
      value.changed
        ? `${value.name} is active. The host boots the deployment it was suspended on.`
        : `${value.name} is already running.`,
    ),
});

export type SuspendInput = { api: PublicApiClient; appId: string };

/**
 * Take an app offline without giving anything of it up. Nothing here is destructive and there is
 * nothing to confirm: what a suspended app costs is its uptime, and resuming is the undo.
 */
export async function suspendApp({ api, appId }: SuspendInput): Promise<AppStateChange> {
  const { app } = await appFor({ api, appId, operation: 'suspend' });
  if (app.state === 'suspended') {
    return { name: app.name, state: app.state, changed: false };
  }

  const suspended = await requestSuspension({ api, appId: app.id });
  return { name: suspended.name, state: suspended.state, changed: true };
}

export async function resumeApp({ api, appId }: SuspendInput): Promise<AppStateChange> {
  const { app } = await appFor({ api, appId, operation: 'resume' });
  if (app.state === 'active') {
    return { name: app.name, state: app.state, changed: false };
  }

  const resumed = await requestResume({ api, appId: app.id });
  return { name: resumed.name, state: resumed.state, changed: true };
}

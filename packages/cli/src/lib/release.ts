import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  awaitDeploymentSettled,
  type Deployed,
  type DeployStep,
  describeUnservedDeployment,
} from '@repo/app-operations';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';
import type { Ui } from '#lib/ui.ts';

const MS_PER_SECOND = 1_000;
const ELAPSED_DECIMALS = 1;

const ReleaseSchema = z.object({
  slug: z.string(),
  appId: z.string(),
  deploymentId: z.string(),
  url: z.string(),
  /** How long the release took to answer, or `null` for a caller that detached rather than wait. */
  readyInMs: z.number().nullable(),
});

export type Release = z.infer<typeof ReleaseSchema>;

export const RELEASE_OUTPUT = defineOutput({
  schema: ReleaseSchema,
  render: ({ value, out }) =>
    out.done(
      value.readyInMs === null
        ? `${value.url} — deployment ${value.deploymentId} is starting`
        : `${value.url} — ready in ${elapsed(value.readyInMs)}`,
    ),
});

export function announce({ step, ui }: { step: DeployStep; ui: Ui }): void {
  if (step.kind === 'app') {
    ui.step(`app ${step.slug}`);
  }
  if (step.kind === 'artifact') {
    ui.step(`artifact ${step.digest}`);
  }
}

/**
 * Wait for the release to answer, then say where it answers. Detached, the address is still what
 * is answered with — a caller who did not want the wait still wants the app.
 */
export async function awaitServing({
  api,
  ui,
  deployed,
  detach,
}: {
  api: PublicApiClient;
  ui: Ui;
  deployed: Deployed;
  detach: boolean | undefined;
}): Promise<Release> {
  const address = {
    slug: deployed.slug,
    appId: deployed.appId,
    deploymentId: deployed.deploymentId,
    url: deployed.url,
  };
  if (detach === true) {
    return { ...address, readyInMs: null };
  }

  const startedAt = Date.now();
  const settled = await ui.waitingFor({
    message: `the app is coming online — deployment ${deployed.deploymentId}`,
    task: () =>
      awaitDeploymentSettled({
        api,
        appId: deployed.appId,
        deploymentId: deployed.deploymentId,
      }),
  });
  if (settled.state !== 'running') {
    throw new ApiError(describeUnservedDeployment(settled));
  }
  return { ...address, readyInMs: Date.now() - startedAt };
}

function elapsed(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS)}s`;
}

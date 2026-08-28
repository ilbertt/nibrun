import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  awaitDeploymentSettled,
  type Deployed,
  type DeployStep,
  describeUnservedDeployment,
} from '@repo/app-operations';
import type { Ui } from '#lib/ui.ts';

const MS_PER_SECOND = 1_000;
const ELAPSED_DECIMALS = 1;

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
 * is printed — a caller who did not want the wait still wants the app.
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
}): Promise<void> {
  if (detach === true) {
    ui.done(`${deployed.url} — deployment ${deployed.deploymentId} is starting`);
    return;
  }

  const startedAt = Date.now();
  const settled = await ui.waitingFor({
    message: `starting deployment ${deployed.deploymentId}`,
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
  ui.done(`${deployed.url} — ready in ${elapsed(Date.now() - startedAt)}`);
}

function elapsed(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS)}s`;
}

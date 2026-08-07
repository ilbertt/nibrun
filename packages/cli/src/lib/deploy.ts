import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import { appBySlug } from '@repo/app-operations';
import { type DeploymentState, GuestPortSchema, type TenantArguments, Value } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';
import type { RunOptions } from '#lib/plan.ts';
import type { Ui } from '#lib/ui.ts';

const SETTLING_STATES = new Set<DeploymentState>(['pending', 'starting']);
// A host now tells the api the moment a tenant answers rather than on its next report, so this
// is what stands between that and the owner being told — and the whole wait is a few seconds.
const POLL_INTERVAL_MS = 500;
const SERVING_TIMEOUT_MS = 300_000;
const MS_PER_SECOND = 1_000;
const ELAPSED_DECIMALS = 1;

export type DeployInput = RunOptions & {
  api: PublicApiClient;
  ui: Ui;
  binary: File;
  args: TenantArguments;
  detach?: boolean | undefined;
};

/**
 * Upload a binary and make it the app's live release.
 *
 * Config is written before the deployment rather than sent with it: a deployment snapshots the
 * app's config as it stands, so this is the only order in which the flags a caller just typed
 * are the ones that run.
 */
export async function deploy({
  api,
  ui,
  binary,
  args,
  app: slug,
  name,
  port,
  detach,
}: DeployInput): Promise<void> {
  const target = slug === undefined ? null : await appBySlug({ api, slug });
  const config = configPatch({ args, port });

  const app =
    target === null
      ? unwrap(await api.api.apps.post({ name: name ?? binary.name, config }))
      : unwrap(await api.api.apps({ appId: target.id }).patch(config));
  ui.step(`app ${app.slug}`);

  const artifact = unwrap(await api.api.apps({ appId: app.id }).artifacts.post({ binary }));
  ui.step(`artifact ${artifact.digest}`);

  const deployment = unwrap(
    await api.api.apps({ appId: app.id }).deployments.post({ artifactId: artifact.id }),
  );

  const url = `https://${platformHostname(app.hostnames)}`;
  if (detach === true) {
    ui.done(`${url} — deployment ${deployment.id} is starting`);
    return;
  }

  const startedAt = Date.now();
  const state = await ui.waitingFor({
    message: `starting deployment ${deployment.id}`,
    task: () => awaitSettled({ api, appId: app.id, deploymentId: deployment.id }),
  });
  if (state !== 'active') {
    throw new ApiError(`Deployment ${deployment.id} is ${state}.`);
  }
  ui.done(`${url} — ready in ${elapsed(Date.now() - startedAt)}`);
}

function elapsed(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS)}s`;
}

// A `File` rather than the `Bun.file` handle it came from: the multipart filename is read off
// `name`, and the api keeps it as what the binary is called again inside an export.
export async function readBinary(path: string): Promise<File> {
  const handle = Bun.file(path);
  if (!(await handle.exists())) {
    throw new UsageError(`No such file: ${path}`);
  }
  return new File([await handle.arrayBuffer()], basename(path));
}

/**
 * `args` is always written, empty included: what the caller typed is what the binary is asked to
 * run with, and carrying over the last deploy's arguments because none were given this time
 * would run something nobody asked for.
 */
function configPatch({ args, port }: Pick<RunOptions, 'port'> & { args: TenantArguments }) {
  return {
    args,
    ...(port !== undefined && { guestPort: Value.Parse(GuestPortSchema, port) }),
  };
}

async function awaitSettled({
  api,
  appId,
  deploymentId,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
}): Promise<DeploymentState> {
  const deadline = Date.now() + SERVING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const deployment = unwrap(await api.api.apps({ appId }).deployments({ deploymentId }).get());
    if (!SETTLING_STATES.has(deployment.state)) {
      return deployment.state;
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new ApiError(
    `Deployment ${deploymentId} was still starting after ${SERVING_TIMEOUT_MS}ms.`,
  );
}

function platformHostname(hostnames: ReadonlyArray<{ hostname: string; kind: string }>): string {
  const platform = hostnames.find((entry) => entry.kind === 'platform') ?? hostnames[0];
  if (!platform) {
    throw new ApiError('The app was created without a hostname.');
  }
  return platform.hostname;
}

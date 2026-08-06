import { basename } from 'node:path';
import type { Print } from '@parshjs/core';
import {
  DEFAULT_INSTANCE_RESOURCES,
  type DeploymentState,
  type GuestPort,
  type InstanceResources,
  type TenantArguments,
} from '@repo/protocol';
import { type Api, ApiError, unwrap } from '#lib/api.ts';

const SETTLING_STATES = new Set<DeploymentState>(['pending', 'starting']);
const POLL_INTERVAL_MS = 2_000;
const SERVING_TIMEOUT_MS = 300_000;

type ResourceOverrides = {
  port?: number | undefined;
  vcpu?: number | undefined;
  memory?: number | undefined;
};

export type DeployInput = ResourceOverrides & {
  api: Api;
  print: Print;
  binaryPath: string;
  args: TenantArguments;
  app?: string | undefined;
  name?: string | undefined;
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
  print,
  binaryPath,
  args,
  app: slug,
  name,
  detach,
  ...resources
}: DeployInput): Promise<void> {
  const binary = await readBinary(binaryPath);
  const target = slug === undefined ? null : await appBySlug({ api, slug });
  const config = configPatch({
    args,
    current: target?.config.resources ?? DEFAULT_INSTANCE_RESOURCES,
    ...resources,
  });

  const app =
    target === null
      ? unwrap(await api.api.apps.post({ name: name ?? binary.name, config }))
      : unwrap(await api.api.apps({ appId: target.id }).patch(config));
  print.dim(`app ${app.slug}`);

  const artifact = unwrap(await api.api.apps({ appId: app.id }).artifacts.post({ binary }));
  print.dim(`artifact ${artifact.digest}`);

  const deployment = unwrap(
    await api.api.apps({ appId: app.id }).deployments.post({ artifactId: artifact.id }),
  );
  print.dim(`deployment ${deployment.id}`);

  const url = `https://${platformHostname(app.hostnames)}`;
  if (detach === true) {
    print.success(url);
    return;
  }

  const state = await awaitSettled({ api, appId: app.id, deploymentId: deployment.id });
  if (state !== 'active') {
    throw new ApiError(`Deployment ${deployment.id} is ${state}.`);
  }
  print.success(url);
}

// A `File` rather than the `Bun.file` handle it came from: the multipart filename is read off
// `name`, and the api keeps it as what the binary is called again inside an export.
async function readBinary(path: string): Promise<File> {
  const handle = Bun.file(path);
  if (!(await handle.exists())) {
    throw new ApiError(`No such file: ${path}`);
  }
  return new File([await handle.arrayBuffer()], basename(path));
}

// Apps are addressed by id and listed by slug; the slug is the half a person sees, so it is the
// half the CLI takes and this is where the two meet.
async function appBySlug({ api, slug }: { api: Api; slug: string }) {
  const { apps } = unwrap(await api.api.apps.get());
  const found = apps.find((app) => app.slug === slug);
  if (!found) {
    throw new ApiError(`No app with slug ${slug}.`);
  }
  return found;
}

/**
 * `args` is always written, empty included: what was typed after `--` is what the binary is asked
 * to run with, and carrying over the last deploy's arguments because none were given this time
 * would run something nobody asked for.
 */
function configPatch({
  args,
  current,
  port,
  vcpu,
  memory,
}: ResourceOverrides & { args: TenantArguments; current: InstanceResources }) {
  return {
    args,
    ...(port !== undefined && { guestPort: port as GuestPort }),
    ...((vcpu !== undefined || memory !== undefined) && {
      resources: {
        vcpuCount: vcpu ?? current.vcpuCount,
        memoryMib: memory ?? current.memoryMib,
      },
    }),
  };
}

async function awaitSettled({
  api,
  appId,
  deploymentId,
}: {
  api: Api;
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

import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  awaitDeploymentSettled,
  type DeployStep,
  deploy as startDeployment,
} from '@repo/app-operations';
import { type Filename, FilenameSchema, type TenantArguments, Value } from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';
import type { RunOptions } from '#lib/plan.ts';
import type { Ui } from '#lib/ui.ts';

const MS_PER_SECOND = 1_000;
const ELAPSED_DECIMALS = 1;

/** The binary as this end knows it: where to read it from, not the bytes themselves. */
export type LocalBinary = {
  path: string;
  name: Filename;
  sizeBytes: number;
};

export type DeployInput = RunOptions & {
  api: PublicApiClient;
  ui: Ui;
  binary: LocalBinary;
  args: TenantArguments;
  detach?: boolean | undefined;
};

export async function deploy({
  api,
  ui,
  binary,
  args,
  app,
  name,
  port,
  detach,
}: DeployInput): Promise<void> {
  const deployed = await startDeployment({
    api,
    binary: { name: binary.name, sizeBytes: binary.sizeBytes, body: Bun.file(binary.path) },
    args,
    app,
    name,
    port,
    onStep: (step) => announce({ step, ui }),
    whileUploading: ui.waitingFor,
  });

  if (detach === true) {
    ui.done(`${deployed.url} — deployment ${deployed.deploymentId} is starting`);
    return;
  }

  const startedAt = Date.now();
  const state = await ui.waitingFor({
    message: `starting deployment ${deployed.deploymentId}`,
    task: () =>
      awaitDeploymentSettled({
        api,
        appId: deployed.appId,
        deploymentId: deployed.deploymentId,
      }),
  });
  if (state !== 'active') {
    throw new ApiError(`Deployment ${deployed.deploymentId} is ${state}.`);
  }
  ui.done(`${deployed.url} — ready in ${elapsed(Date.now() - startedAt)}`);
}

function announce({ step, ui }: { step: DeployStep; ui: Ui }): void {
  if (step.kind === 'app') {
    ui.step(`app ${step.slug}`);
  }
  if (step.kind === 'artifact') {
    ui.step(`artifact ${step.digest}`);
  }
}

function elapsed(ms: number): string {
  return `${(ms / MS_PER_SECOND).toFixed(ELAPSED_DECIMALS)}s`;
}

/**
 * Opened rather than read: the bytes are streamed to the store when the time comes, and all
 * that is wanted here is that there is a file, what it is called, and how large it is.
 */
export async function openBinary(path: string): Promise<LocalBinary> {
  const handle = Bun.file(path);
  if (!(await handle.exists())) {
    throw new UsageError(`No such file: ${path}`);
  }
  return { path, name: asFilename(basename(path)), sizeBytes: handle.size };
}

/**
 * The name travels with the binary — it is what a host writes into an export archive, which the
 * api will not take as anything but a single plain path segment. Said here so that a name it
 * would refuse costs a line rather than the upload that preceded the refusal.
 */
function asFilename(name: string): Filename {
  try {
    return Value.Parse(FilenameSchema, name);
  } catch {
    throw new UsageError(
      `A binary's name must start with a letter or digit and hold only letters, digits, dots, dashes or underscores: ${name}`,
    );
  }
}

import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  awaitDeploymentSettled,
  type DeployStep,
  describeUnservedDeployment,
  InvalidEnvironmentError,
  parseEnvironment,
  deploy as startDeployment,
  type UploadableBinary,
} from '@repo/app-operations';
import {
  type Filename,
  FilenameSchema,
  type TenantArguments,
  type TenantEnvironmentPatch,
  Value,
} from '@repo/protocol';
import { UsageError } from '#lib/errors.ts';
import type { RunOptions } from '#lib/plan.ts';
import type { Ui } from '#lib/ui.ts';
import { describeProgress } from '#lib/upload-progress.ts';

const MS_PER_SECOND = 1_000;
const ELAPSED_DECIMALS = 1;

export type DeployInput = RunOptions & {
  api: PublicApiClient;
  ui: Ui;
  binary: UploadableBinary;
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
  env,
  unset,
  detach,
}: DeployInput): Promise<void> {
  const environment = asEnvironment({ env, unset });
  const deployed = await startDeployment({
    api,
    binary,
    args,
    app,
    name,
    port,
    ...(environment !== undefined && { environment }),
    onStep: (step) => announce({ step, ui }),
    whileUploading: ({ message, task }) => {
      const startedAt = Date.now();
      return ui.waitingFor({
        message,
        task: (update) =>
          task((progress) =>
            update(
              `${message} — ${describeProgress({ progress, elapsedMs: Date.now() - startedAt })}`,
            ),
          ),
      });
    },
  });

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
  if (settled.state !== 'active') {
    throw new ApiError(describeUnservedDeployment(settled));
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
 * that is wanted here is that there is a file and what it is called.
 */
export async function openBinary(path: string): Promise<UploadableBinary> {
  const body = Bun.file(path);
  if (!(await body.exists())) {
    throw new UsageError(`No such file: ${path}`);
  }
  return { name: asFilename(basename(path)), body };
}

/**
 * Undefined where neither flag was given, which is what leaves the app's environment alone: an
 * empty edit would be a request to change nothing, sent on every deploy that mentions none.
 *
 * The shared parser does not know what a command line is, so what it refuses is reported here in
 * the words `nib` refuses anything else in.
 */
function asEnvironment({
  env = [],
  unset = [],
}: {
  env?: string[] | undefined;
  unset?: string[] | undefined;
}): TenantEnvironmentPatch | undefined {
  if (env.length === 0 && unset.length === 0) {
    return undefined;
  }

  try {
    return parseEnvironment({ set: env, remove: unset });
  } catch (failure) {
    if (failure instanceof InvalidEnvironmentError) {
      throw new UsageError(failure.message);
    }
    throw failure;
  }
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

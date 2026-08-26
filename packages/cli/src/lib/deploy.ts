import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { deploy as startDeployment, type UploadableBinary } from '@repo/app-operations';
import { type Filename, FilenameSchema, type TenantArguments, Value } from '@repo/protocol';
import { environmentEdit } from '#lib/environment.ts';
import { UsageError } from '#lib/errors.ts';
import type { RunOptions } from '#lib/plan.ts';
import { announce, awaitServing } from '#lib/release.ts';
import type { Ui } from '#lib/ui.ts';
import { describeProgress } from '#lib/upload-progress.ts';

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
  const environment = environmentEdit({ env, unset });
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

  await awaitServing({ api, ui, deployed, detach });
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

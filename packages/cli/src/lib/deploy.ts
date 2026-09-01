import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import {
  type DeployableBinary,
  deploy as startDeployment,
  type UploadableBinary,
} from '@repo/app-operations';
import {
  type Filename,
  FilenameSchema,
  type Sha256Digest,
  Sha256DigestSchema,
  type TenantArguments,
  Value,
} from '@repo/protocol';
import { environmentEdit } from '#lib/environment.ts';
import { UsageError } from '#lib/errors.ts';
import type { RunOptions } from '#lib/plan.ts';
import { announce, awaitServing, type Release } from '#lib/release.ts';
import type { Ui } from '#lib/ui.ts';
import { describeProgress } from '#lib/upload-progress.ts';

export type DeployInput = RunOptions & {
  api: PublicApiClient;
  ui: Ui;
  binary: DeployableBinary;
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
  extraPublicPort,
  env,
  unset,
  detach,
}: DeployInput): Promise<Release> {
  const environment = environmentEdit({ env, unset });
  const deployed = await startDeployment({
    api,
    binary,
    args,
    app,
    name,
    port,
    extraPublicPort,
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

  return await awaitServing({ api, ui, deployed, detach });
}

const SECURE_SCHEME = 'https://';
const INSECURE_SCHEME = 'http://';

/**
 * Where the binary is coming from, as the command line said it: a url for the api to fetch, or a
 * file on this machine to send.
 *
 * A path cannot begin with a scheme, so nothing else has to tell them apart. What the api will
 * take is the api's to say — this only refuses the one mistake whose other reading is a file
 * nobody could ever find.
 */
export async function binaryFrom({
  source,
  sha256,
}: {
  source: string;
  sha256?: string | undefined;
}): Promise<DeployableBinary> {
  if (source.startsWith(SECURE_SCHEME)) {
    return { url: source, sha256: sha256 === undefined ? undefined : asDigest(sha256) };
  }
  if (source.startsWith(INSECURE_SCHEME)) {
    throw new UsageError(`A binary is fetched over https, and this is not: ${source}`);
  }
  // Said rather than ignored: a checksum that went unchecked is the one outcome passing one has
  // to rule out. What it would have checked is a fetch, and this deploy is not one.
  if (sha256 !== undefined) {
    throw new UsageError(
      `--sha256 is for a url nibrun fetches, and this is a file on this machine: ${source}`,
    );
  }
  return await openBinary(source);
}

/**
 * What the url should be serving, in the one spelling the api reads it in. Refused here rather
 * than sent, so a mistyped digest costs a line rather than the whole transfer it would fail at
 * the end of.
 */
function asDigest(sha256: string): Sha256Digest {
  try {
    return Value.Parse(Sha256DigestSchema, sha256.trim().toLowerCase());
  } catch {
    throw new UsageError(
      `A checksum is the 64 hex characters sha256sum prints, and this is not: ${sha256}`,
    );
  }
}

/**
 * Opened rather than read: the bytes are streamed to the store when the time comes, and all
 * that is wanted here is that there is a file and what it is called.
 */
async function openBinary(path: string): Promise<UploadableBinary> {
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

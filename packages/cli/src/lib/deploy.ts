import { basename } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import { appBySlug } from '@repo/app-operations';
import {
  type DeploymentState,
  type Filename,
  FilenameSchema,
  GuestPortSchema,
  type TenantArguments,
  Value,
} from '@repo/protocol';
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
const SIZE_DECIMALS = 1;
const BYTES_PER_MEBIBYTE = 1_048_576;

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

  const artifact = await uploadBinary({ api, ui, appId: app.id, binary });
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

/**
 * The bytes go to the object store, not to the api: a binary is far larger than anything else
 * sent here, and everything between this end and the api — proxies, CDNs — has an opinion about
 * how large a request body may be. The api creates the artifact, says where to put the bytes,
 * and is told afterwards how that went.
 *
 * It is told either way. Only this end watched the upload happen, so an artifact whose bytes
 * never arrived is one nothing else can ever find out about.
 */
async function uploadBinary({
  api,
  ui,
  appId,
  binary,
}: {
  api: PublicApiClient;
  ui: Ui;
  appId: string;
  binary: LocalBinary;
}) {
  const { artifactId, url, fields } = unwrap(
    await api.api.apps({ appId }).artifacts.post({
      filename: binary.name,
      sizeBytes: binary.sizeBytes,
    }),
  );
  const artifact = api.api.apps({ appId }).artifacts({ artifactId });

  try {
    await ui.waitingFor({
      message: `uploading ${binary.name} (${mebibytes(binary.sizeBytes)})`,
      task: () => postBinary({ url, fields, binary }),
    });
  } catch (failure) {
    await artifact.patch({ upload: 'failed' });
    throw failure;
  }

  // The same endpoint answers an abandoned upload with no body at all, so what comes back is
  // only typed as an artifact once this has said it is one.
  const completed = unwrap(await artifact.patch({ upload: 'complete' }));
  if (!completed) {
    throw new ApiError('The api accepted the upload without saying what it stored.');
  }
  return completed;
}

/**
 * A form post rather than a plain PUT, because the store will only hold an upload to a size when
 * the size is part of what was signed, and that is a policy the form carries.
 *
 * The file goes last: the store reads the fields in order and applies the policy to what follows
 * them, so a file sent before them is a file sent under no policy at all.
 *
 * Streamed from disk rather than read into memory — a process that has to hold a binary to send
 * it is a process that cannot send a large one.
 */
async function postBinary({
  url,
  fields,
  binary,
}: {
  url: string;
  fields: Record<string, string>;
  binary: LocalBinary;
}): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append('file', Bun.file(binary.path), binary.name);

  const response = await fetch(url, { method: 'POST', body: form });
  if (!response.ok) {
    throw new ApiError(
      `The store refused the upload: ${response.status} ${await storeError(response)}`,
    );
  }
}

// S3 answers in XML, and the one part of it worth repeating is the sentence it puts in Message.
async function storeError(response: Response): Promise<string> {
  const body = await response.text();
  return /<Message>(?<message>[^<]*)<\/Message>/.exec(body)?.groups?.message ?? response.statusText;
}

function mebibytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(SIZE_DECIMALS)} MB`;
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

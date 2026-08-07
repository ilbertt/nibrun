import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import {
  type DeploymentState,
  type Filename,
  GuestPortSchema,
  type TenantArguments,
  Value,
} from '@repo/protocol';
import { appBySlug } from '#apps.ts';
import { streamedUpload, type UploadProgress, type UploadTransport } from '#upload.ts';
import { pause } from '#wait.ts';

const SETTLING_STATES = new Set<DeploymentState>(['pending', 'starting']);
// A host now tells the api the moment a tenant answers rather than on its next report, so this
// is what stands between that and the owner being told — and the whole wait is a few seconds.
const POLL_INTERVAL_MS = 500;
const SERVING_TIMEOUT_MS = 300_000;
const SIZE_DECIMALS = 1;
const BYTES_PER_MEBIBYTE = 1_048_576;

export type UploadableBinary = {
  name: Filename;
  body: Blob;
};

export type DeployStep =
  | { kind: 'app'; appId: string; slug: string }
  | { kind: 'artifact'; artifactId: string; digest: string }
  | { kind: 'deployment'; deploymentId: string };

/**
 * The wait around the upload, given what the upload is doing rather than a line to print: how far
 * along it is reads as a spinner in one place and a meter in another, and neither belongs here.
 */
export type UploadWait = (input: {
  message: string;
  task: (report: (progress: UploadProgress) => void) => Promise<void>;
}) => Promise<void>;

export type DeployInput = {
  api: PublicApiClient;
  binary: UploadableBinary;
  args: TenantArguments;
  app?: string | undefined;
  name?: string | undefined;
  port?: number | undefined;
  onStep?: ((step: DeployStep) => void) | undefined;
  whileUploading?: UploadWait | undefined;
  upload?: UploadTransport | undefined;
};

export type Deployed = {
  appId: string;
  slug: string;
  deploymentId: string;
  url: string;
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
  binary,
  args,
  app: slug,
  name,
  port,
  onStep,
  whileUploading = unwatched,
  upload = streamedUpload,
}: DeployInput): Promise<Deployed> {
  const target = slug === undefined ? null : await appBySlug({ api, slug });
  const config = configPatch({ args, port });

  const app =
    target === null
      ? unwrap(await api.api.apps.post({ name: name ?? binary.name, config }))
      : unwrap(await api.api.apps({ appId: target.id }).patch(config));
  onStep?.({ kind: 'app', appId: app.id, slug: app.slug });

  const artifact = await uploadBinary({ api, appId: app.id, binary, whileUploading, upload });
  onStep?.({ kind: 'artifact', artifactId: artifact.id, digest: artifact.digest });

  const deployment = unwrap(
    await api.api.apps({ appId: app.id }).deployments.post({ artifactId: artifact.id }),
  );
  onStep?.({ kind: 'deployment', deploymentId: deployment.id });

  return {
    appId: app.id,
    slug: app.slug,
    deploymentId: deployment.id,
    url: `https://${platformHostname(app.hostnames)}`,
  };
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
  appId,
  binary,
  whileUploading,
  upload,
}: {
  api: PublicApiClient;
  appId: string;
  binary: UploadableBinary;
  whileUploading: UploadWait;
  upload: UploadTransport;
}) {
  const { artifactId, url } = unwrap(
    await api.api.apps({ appId }).artifacts.post({
      filename: binary.name,
      sizeBytes: binary.body.size,
    }),
  );
  const artifact = api.api.apps({ appId }).artifacts({ artifactId });

  try {
    await whileUploading({
      message: `uploading ${binary.name} (${mebibytes(binary.body.size)})`,
      task: (report) => putBinary({ url, body: binary.body, upload, onProgress: report }),
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
 * The whole binary as the body, never held here: something that has to hold a binary to send it
 * is something that cannot send a large one.
 *
 * The url was signed for this exact length, so the store refuses anything else — which is also
 * why a file that changed since it was measured comes back as a signature that does not match.
 */
async function putBinary({
  url,
  body,
  upload,
  onProgress,
}: {
  url: string;
  body: Blob;
  upload: UploadTransport;
  onProgress: (progress: UploadProgress) => void;
}): Promise<void> {
  const response = await upload({ url, body, onProgress });
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

function unwatched({
  task,
}: {
  message: string;
  task: (report: (progress: UploadProgress) => void) => Promise<void>;
}): Promise<void> {
  return task(() => {});
}

function mebibytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(SIZE_DECIMALS)} MB`;
}

/**
 * `args` is always written, empty included: what the caller typed is what the binary is asked to
 * run with, and carrying over the last deploy's arguments because none were given this time
 * would run something nobody asked for.
 */
function configPatch({ args, port }: { args: TenantArguments; port: number | undefined }) {
  return {
    args,
    ...(port !== undefined && { guestPort: Value.Parse(GuestPortSchema, port) }),
  };
}

export async function awaitDeploymentSettled({
  api,
  appId,
  deploymentId,
  signal,
}: {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
  signal?: AbortSignal | undefined;
}): Promise<DeploymentState> {
  const deadline = Date.now() + SERVING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const deployment = unwrap(await api.api.apps({ appId }).deployments({ deploymentId }).get());
    if (!SETTLING_STATES.has(deployment.state)) {
      return deployment.state;
    }
    await pause(POLL_INTERVAL_MS);
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

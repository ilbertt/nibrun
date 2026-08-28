import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import type { DeploymentState, Filename, TenantArguments } from '@repo/protocol';
import { appFor } from '#apps.ts';
import {
  type ConfigEdit,
  configPatch,
  type Deployed,
  type DeployStep,
  servingHostname,
} from '#release.ts';
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

/**
 * A binary the api fetches for itself. Nothing is sent from here at all: a release asset is served
 * by a store that answers no cross-origin request, so the end that can read one is the api — and
 * the bytes travel once, between the two ends that are not this one.
 */
export type FetchableBinary = {
  url: string;
};

export type DeployableBinary = UploadableBinary | FetchableBinary;

function isFetchable(binary: DeployableBinary): binary is FetchableBinary {
  return 'url' in binary;
}

/**
 * What to call the app when the caller named none: the binary, however it is being delivered.
 *
 * A url is read for a name here only to have one to call the app — what the binary is called once
 * it is stored is the api's to decide, from the url it is the one fetching.
 */
function binaryName(binary: DeployableBinary): string | undefined {
  return isFetchable(binary) ? lastSegment(binary.url) : binary.name;
}

function lastSegment(url: string): string | undefined {
  const segment = url.split('?')[0]?.split('/').at(-1);
  return segment === undefined || segment === '' ? undefined : decodeURIComponent(segment);
}

/**
 * The wait around the upload, given what the upload is doing rather than a line to print: how far
 * along it is reads as a spinner in one place and a meter in another, and neither belongs here.
 */
export type UploadWait = (input: {
  message: string;
  task: (report: (progress: UploadProgress) => void) => Promise<void>;
}) => Promise<void>;

export type DeployInput = ConfigEdit & {
  api: PublicApiClient;
  binary: DeployableBinary;
  // Required where the rest of the edit is optional: what the caller typed is what the binary is
  // asked to run with, and carrying over the last release's arguments because none were given
  // this time would run something nobody asked for.
  args: TenantArguments;
  app?: string | undefined;
  name?: string | undefined;
  onStep?: ((step: DeployStep) => void) | undefined;
  whileUploading?: UploadWait | undefined;
  upload?: UploadTransport | undefined;
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
  app: slug,
  name,
  onStep,
  whileUploading = unwatched,
  upload = streamedUpload,
  ...edit
}: DeployInput): Promise<Deployed> {
  const target = slug === undefined ? null : await appFor({ api, slug, operation: 'release' });
  const config = configPatch(edit);

  const app =
    target === null
      ? await createApp({ api, name: name ?? binaryName(binary), config })
      : unwrap(await api.api.apps({ appId: target.app.id }).patch(config));
  onStep?.({ kind: 'app', appId: app.id, slug: app.slug });

  const artifact = isFetchable(binary)
    ? await fetchBinary({ api, appId: app.id, binary })
    : await uploadBinary({ api, appId: app.id, binary, whileUploading, upload });
  onStep?.({ kind: 'artifact', artifactId: artifact.id, digest: artifact.digest });

  const deployment = unwrap(
    await api.api.apps({ appId: app.id }).deployments.post({ artifactId: artifact.id }),
  );
  onStep?.({ kind: 'deployment', deploymentId: deployment.id });

  return {
    appId: app.id,
    slug: app.slug,
    deploymentId: deployment.id,
    url: `https://${servingHostname(app.hostnames)}`,
  };
}

/**
 * Named before anything is made rather than by the request that makes it: an app created for a
 * deploy that cannot go on is one the caller is left to go and delete.
 */
async function createApp({
  api,
  name,
  config,
}: {
  api: PublicApiClient;
  name: string | undefined;
  config: ReturnType<typeof configPatch>;
}) {
  if (name === undefined) {
    throw new ApiError('An app needs a name, and this url ends in nothing to take one from.');
  }
  return unwrap(await api.api.apps.post({ name, config }));
}

/**
 * The one request the bytes happen during: the api fetches, hashes and stores them while it is
 * held open, so there is nothing to report on and nothing to say afterwards about how it went.
 */
async function fetchBinary({
  api,
  appId,
  binary,
}: {
  api: PublicApiClient;
  appId: string;
  binary: FetchableBinary;
}): Promise<StoredArtifact> {
  const created = unwrap(await api.api.apps({ appId }).artifacts.post({ url: binary.url }));
  if (!isStored(created)) {
    throw new ApiError('The api answered a fetched binary with somewhere to upload one.');
  }
  return created;
}

/**
 * Which of the two answers `POST artifacts` gave. A caller knows which it is owed by what it
 * asked for, so this is only ever the check that the api agreed.
 */
type CreatedArtifact = Awaited<
  ReturnType<ReturnType<PublicApiClient['api']['apps']>['artifacts']['post']>
>['data'];

type StoredArtifact = Extract<NonNullable<CreatedArtifact>, { digest: string }>;

function isStored(created: NonNullable<CreatedArtifact>): created is StoredArtifact {
  return 'digest' in created;
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
  const created = unwrap(
    await api.api.apps({ appId }).artifacts.post({
      filename: binary.name,
      sizeBytes: binary.body.size,
    }),
  );
  if (isStored(created)) {
    throw new ApiError('The api answered an upload with an artifact nobody sent it.');
  }
  const { artifactId, url } = created;
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

/** What a caller needs of a release that has stopped moving: which end it reached, and why. */
export type SettledDeployment = {
  id: string;
  state: DeploymentState;
  message?: string | undefined;
};

/**
 * Why a release that settled is not serving, in the host's own words where it left any. Shared
 * because a terminal and a browser accounting for the same failure differently is how one of
 * them ends up saying only that it happened.
 */
export function describeUnservedDeployment(deployment: SettledDeployment): string {
  const reason = deployment.message === undefined ? '' : ` ${deployment.message}`;
  return `Deployment ${deployment.id} is ${deployment.state}.${reason}`;
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
}): Promise<SettledDeployment> {
  const deadline = Date.now() + SERVING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const deployment = unwrap(await api.api.apps({ appId }).deployments({ deploymentId }).get());
    if (!SETTLING_STATES.has(deployment.state)) {
      return deployment;
    }
    await pause(POLL_INTERVAL_MS);
  }
  throw new ApiError(
    `Deployment ${deploymentId} was still starting after ${SERVING_TIMEOUT_MS}ms.`,
  );
}

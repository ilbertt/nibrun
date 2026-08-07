import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import type { ExportState } from '@repo/protocol';
import { pause } from '#wait.ts';

const MS_PER_MINUTE = 60_000;

/**
 * Longer between polls than a deployment takes, because the wait is a different kind: a
 * deployment is a guest starting, an export is a filesystem being read with no bound on how much
 * is in it.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * The host allows itself an hour to read one tenant's filesystem, so giving up sooner would be
 * giving up on an export that is still coming. Giving up costs little either way: the request
 * stays in flight, and asking again is answered with it rather than with a second read.
 */
const READY_TIMEOUT_MINUTES = 60;

const STILL_COMING: ReadonlySet<ExportState> = new Set<ExportState>(['pending', 'preparing']);

export type ExportBundle = { downloadUrl: string; sizeBytes: number | undefined };

export async function requestExport({
  api,
  appId,
}: {
  api: PublicApiClient;
  appId: string;
}): Promise<{ id: string; state: ExportState }> {
  return unwrap(await api.api.apps({ appId }).exports.post());
}

/**
 * Poll until the host has written the bundle.
 *
 * A download URL rather than a state is what says it is there: the URL is signed for the response
 * it arrives in and outlives it by minutes, so the one that is read is the one the download uses.
 */
export async function awaitExportBundle({
  api,
  appId,
  exportId,
  signal,
}: {
  api: PublicApiClient;
  appId: string;
  exportId: string;
  signal?: AbortSignal | undefined;
}): Promise<ExportBundle> {
  const deadline = Date.now() + READY_TIMEOUT_MINUTES * MS_PER_MINUTE;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const found = unwrap(await api.api.apps({ appId }).exports({ exportId }).get());
    if (found.downloadUrl !== undefined) {
      return { downloadUrl: found.downloadUrl, sizeBytes: found.sizeBytes };
    }
    if (!STILL_COMING.has(found.state)) {
      throw new ApiError(`Export ${exportId} is ${found.state}.`);
    }
    await pause(POLL_INTERVAL_MS);
  }
  throw new ApiError(
    `Export ${exportId} was still being prepared after ${READY_TIMEOUT_MINUTES} minutes. Asking again is answered with this one until it is ready.`,
  );
}

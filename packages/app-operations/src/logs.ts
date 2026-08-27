import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { SeenTenantLogs, type TenantLogRecord } from '@repo/protocol';
import { pause } from '#wait.ts';

/**
 * How much of the gap a reconnect asks to be told about.
 *
 * Only the first stream wants the range the reader asked for; a later one is picking up after a
 * close and wants the seconds it was away, not that history again. Generous, because overlap is
 * cheap here — `SeenTenantLogs` drops what has already been shown — and a gap is not recoverable.
 */
const RECONNECT_TIMERANGE = '30s';

/** What a closed stream costs before we open another, so a refusing api is not hammered. */
const RECONNECT_PAUSE_MS = 1_000;

export type FollowInput = {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
  timerange: string;
  /** Whether to wait on what the app has not written yet, which one that is not running never will. */
  following?: boolean | undefined;
  signal: AbortSignal;
};

/**
 * What a deployment has written, and what it writes from then on until stopped.
 *
 * The api closes a stream on its own clock so that who may read it is asked again rather than
 * decided once, which makes reaching the end of one an instruction to open another rather than
 * the end of the log. Opening another is why `SeenTenantLogs` outlives them all: a reconnect asks
 * for the seconds it was away, and what it was not away for comes back a second time.
 */
export async function* followLogs({
  api,
  appId,
  deploymentId,
  timerange,
  following = true,
  signal,
}: FollowInput): AsyncGenerator<TenantLogRecord> {
  const logs = api.api.apps({ appId }).deployments({ deploymentId }).logs;
  const seen = new SeenTenantLogs();
  let asked = timerange;

  // Stopping part-way through a stream is the ordinary ending, and it arrives as a failed request
  // rather than a last record. The signal is what says so, not the error.
  try {
    while (!signal.aborted) {
      const stream = unwrap(
        await logs.get({ query: { timerange: asked, follow: following }, fetch: { signal } }),
      );
      for await (const { data } of stream) {
        if (seen.admit(data)) {
          yield data;
        }
      }
      // Reaching the end of a stream that was not following is reaching the end of the log: the
      // api answered with everything it had rather than closing on its own clock.
      if (!following) {
        return;
      }
      asked = RECONNECT_TIMERANGE;
      await pause(RECONNECT_PAUSE_MS);
    }
  } catch (failure) {
    if (!signal.aborted) {
      throw failure;
    }
  }
}

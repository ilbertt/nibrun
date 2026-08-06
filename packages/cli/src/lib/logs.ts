import type { Print } from '@parshjs/core';
import type { TenantLogRecord } from '@repo/protocol';
import { type Api, unwrap } from '#lib/api.ts';
import { ApiError } from '#lib/errors.ts';

const NO_DEPLOYMENTS = 'This app has never been deployed.';

/**
 * How much of the gap a reconnect asks to be told about.
 *
 * Only the first stream wants the range the reader asked for; a later one is picking up after a
 * close and wants the seconds it was away, not that history again. Generous, because overlap is
 * cheap here — `Printed` drops what has already been shown — and a gap is not recoverable.
 */
const RECONNECT_TIMERANGE = '30s';

/** What a closed stream costs before we open another, so a refusing api is not hammered. */
const RECONNECT_PAUSE_MS = 1_000;

/**
 * The deployment a reader means by not naming one. The api lists them newest first, so this is
 * the head of the list rather than a search through it.
 */
export async function latestDeployment({
  api,
  appId,
}: {
  api: Api;
  appId: string;
}): Promise<string> {
  const { deployments } = unwrap(await api.api.apps({ appId }).deployments.get());
  const newest = deployments[0];
  if (!newest) {
    throw new ApiError(NO_DEPLOYMENTS);
  }
  return newest.id;
}

/**
 * Ctrl-C, as something a loop can read rather than something that kills it mid-line.
 *
 * Following ends no other way, so this is the whole of what ends it. Listening once rather than
 * for as long as we run is what leaves the second Ctrl-C to the default handler: someone pressing
 * it again is saying the graceful stop is taking too long, and they are owed the abrupt one.
 */
export function untilInterrupted(): AbortSignal {
  const stopping = new AbortController();
  process.once('SIGINT', () => stopping.abort());
  return stopping.signal;
}

export type FollowInput = {
  api: Api;
  appId: string;
  deploymentId: string;
  timerange: string;
  print: Print;
  signal: AbortSignal;
};

/**
 * Print what a deployment has written, and keep printing what it writes until stopped.
 *
 * The api closes a stream on its own clock so that who may read it is asked again rather than
 * decided once, which makes reaching the end of one an instruction to open another rather than
 * the end of the log. Opening another is why `Printed` outlives them all: a reconnect asks for
 * the seconds it was away, and what it was not away for comes back a second time.
 */
export async function follow({
  api,
  appId,
  deploymentId,
  timerange,
  print,
  signal,
}: FollowInput): Promise<void> {
  const logs = api.api.apps({ appId }).deployments({ deploymentId }).logs;
  const printed = new Printed();
  let asked = timerange;

  // Stopping part-way through a stream is the ordinary ending, and it arrives as a failed request
  // rather than a last record. The signal is what says so, not the error.
  try {
    while (!signal.aborted) {
      const stream = unwrap(await logs.get({ query: { timerange: asked }, fetch: { signal } }));
      for await (const { data } of stream) {
        if (printed.admit(data)) {
          show({ record: data, print });
        }
      }
      asked = RECONNECT_TIMERANGE;
      await Bun.sleep(RECONNECT_PAUSE_MS);
    }
  } catch (failure) {
    if (!signal.aborted) {
      throw failure;
    }
  }
}

/**
 * What has already been printed, so a reconnect does not print it again.
 *
 * A stream cannot be resumed from where the last one stopped — there is no cursor on the wire —
 * so a new one asks for the seconds around the gap and carries whatever else was in them.
 * `sourceId` and `sequence` are what tell a second copy from a second record: sequence counts
 * within one source and only rises, so the highest seen is the whole of what has to be remembered.
 */
export class Printed {
  readonly #highest = new Map<string, number>();

  admit(record: TenantLogRecord): boolean {
    const seen = this.#highest.get(record.sourceId);
    if (seen !== undefined && record.sequence <= seen) {
      return false;
    }
    this.#highest.set(record.sourceId, record.sequence);
    return true;
  }
}

/**
 * Which stream a record came out of decides which one it goes back into, the way `docker logs`
 * does it: the app's error output is this program's error output, so `2>` and `>` separate them
 * again downstream. `print` colours by level, which is the same distinction said in colour.
 */
export function show({ record, print }: { record: TenantLogRecord; print: Print }): void {
  const line = render(record);
  if (record.droppedBytes !== undefined) {
    print.warn(line);
    return;
  }
  if (record.stream === 'stderr') {
    print.error(line);
    return;
  }
  print.info(line);
}

export function render(record: TenantLogRecord): string {
  const gap = record.droppedBytes === undefined ? '' : ` (${record.droppedBytes} bytes)`;
  return `${clockOf(record._time)} ${record.stream === 'stderr' ? 'err' : 'out'} ${record._msg}${gap}`;
}

const CLOCK_START = 11;
const CLOCK_END = 23;

/**
 * The time of day the store recorded, in UTC. The date is left off because someone watching an app
 * is watching now, and the whole date on every line would crowd out the line itself.
 */
function clockOf(instant: string): string {
  return new Date(instant).toISOString().slice(CLOCK_START, CLOCK_END);
}

import type { Print } from '@parshjs/core';
import { SeenTenantLogs, type TenantLogRecord } from '@repo/protocol';
import { type Api, unwrap } from '#lib/api.ts';

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
 * the end of the log. Opening another is why `SeenTenantLogs` outlives them all: a reconnect asks
 * for the seconds it was away, and what it was not away for comes back a second time.
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
  const printed = new SeenTenantLogs();
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

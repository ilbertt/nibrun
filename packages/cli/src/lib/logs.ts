import type { Print } from '@parshjs/core';
import type { TenantLogRecord, Timestamp } from '@repo/protocol';
import { type Api, unwrap } from '#lib/api.ts';
import { ApiError } from '#lib/errors.ts';

const NO_DEPLOYMENTS = 'This app has never been deployed.';

/**
 * What a page that told us nothing costs before we ask again.
 *
 * The api holds an ask open while the log is quiet, so following an app never reaches this: a page
 * that brought something is asked after at once, and one that brought nothing has already spent
 * its wait on the other end. It is here for when that stops being true — a proxy answering short,
 * an api that stops holding — where the difference is a poll a second rather than a hot loop
 * against someone else's server.
 */
const QUIET_PAUSE_MS = 1_000;

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
 * Every page comes back with the instant to resume from, and asking again with it is the whole of
 * what following is. The api holds an ask open while the log is quiet rather than answering it
 * empty, so this runs at the speed the app writes rather than at a poll interval of its own.
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
  let since: Timestamp | undefined;

  // Stopping part-way through an ask is the ordinary ending — the api holds one open for as long
  // as it can, so that is where a reader almost always is when they stop. It arrives as a failed
  // request rather than a last page, and the signal is what says so, not the error.
  try {
    while (!signal.aborted) {
      const page = unwrap(
        await logs.get({
          query: since === undefined ? { timerange } : { since },
          fetch: { signal },
        }),
      );
      const fresh = page.records.filter((record) => printed.admit(record));
      for (const record of fresh) {
        show({ record, print });
      }
      since = page.cursor;

      // Nothing to show is the only thing worth pausing on, and it is not the same as an empty
      // page: one that repeated what the last ended on and added nothing is equally no progress.
      if (fresh.length === 0) {
        await Bun.sleep(QUIET_PAUSE_MS);
      }
    }
  } catch (failure) {
    if (!signal.aborted) {
      throw failure;
    }
  }
}

/**
 * What has already been printed, so a page overlapping the one before it is not printed twice.
 *
 * A page resumes on the instant the last one ended rather than after it: the store stamps to the
 * millisecond, and a record sharing that instant may not have been written when the last page was
 * read. Dropping it would be worse than repeating it, so the api repeats — and `sourceId` and
 * `sequence` are what tell a second copy from a second record. Sequence counts within one source
 * and only rises, so the highest one seen is the whole of what has to be remembered.
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

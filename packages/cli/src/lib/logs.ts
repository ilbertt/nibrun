import type { TenantLogRecord, TenantLogStream, Timestamp } from '@repo/protocol';
import chalk from 'chalk';
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

export type FollowInput = {
  api: Api;
  appId: string;
  deploymentId: string;
  timerange: string;
  write: (line: string) => void;
};

/**
 * Print what a deployment has written, and keep printing what it writes.
 *
 * Every page comes back with the instant to resume from, and asking again with it is the whole of
 * what following is. The api holds an ask open while the log is quiet rather than answering it
 * empty, so this loop runs at the speed the app writes rather than at a poll interval of its own
 * — and there is no way out of it short of the process ending, because following has no last page.
 */
export async function follow({
  api,
  appId,
  deploymentId,
  timerange,
  write,
}: FollowInput): Promise<never> {
  const logs = api.api.apps({ appId }).deployments({ deploymentId }).logs;
  const printed = new Printed();
  let since: Timestamp | undefined;

  for (;;) {
    const page = unwrap(await logs.get({ query: since === undefined ? { timerange } : { since } }));
    const fresh = page.records.filter((record) => printed.admit(record));
    for (const record of fresh) {
      write(render(record));
    }
    since = page.cursor;

    // Nothing to show is the only thing worth pausing on, and it is not the same as an empty page:
    // a page that repeated what the last one ended on and added nothing is equally no progress.
    if (fresh.length === 0) {
      await Bun.sleep(QUIET_PAUSE_MS);
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

const STREAM_LABEL = {
  stdout: chalk.cyan('out'),
  stderr: chalk.red('err'),
} as const satisfies Record<TenantLogStream, string>;

export function render(record: TenantLogRecord): string {
  return `${chalk.dim(clockOf(record._time))} ${STREAM_LABEL[record.stream]} ${body(record)}`;
}

const CLOCK_START = 11;
const CLOCK_END = 23;

/**
 * The time of day the store recorded, in UTC. The date is left off because someone watching an app
 * is watching now, and it is dimmed because the line beside it is what they came for.
 */
function clockOf(instant: string): string {
  return new Date(instant).toISOString().slice(CLOCK_START, CLOCK_END);
}

// A gap is what the host wrote in place of output it had to drop, so it is marked as the one line
// in the stream that is not the app's own.
function body(record: TenantLogRecord): string {
  return record.droppedBytes === undefined
    ? record._msg
    : chalk.yellow(`${record._msg} (${record.droppedBytes} bytes)`);
}

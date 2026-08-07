import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { SeenTenantLogs, type TenantLogRecord, type TenantLogStream } from '@repo/protocol';

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
  api: PublicApiClient;
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

/** Wide enough that a column still reads as one against a message that begins with a space. */
const COLUMN_GAP = '  ';

/**
 * What ends a line the guest wrote, which is not part of what it said.
 *
 * The store keeps the terminator, because a record is whatever bytes arrived. Printing is what
 * supplies one — so leaving it on puts an empty line between every two records.
 */
const TERMINATOR = /\r?\n$/;

/** One record, one line: what the app wrote, behind a dimmed column saying when and from where. */
export function render(record: TenantLogRecord): string {
  const gap = record.droppedBytes === undefined ? '' : ` (${record.droppedBytes} bytes)`;
  const mark = record.stream === 'stderr' ? 'err' : 'out';
  const column = dimmed({
    text: `${stampOf(record._time)}${COLUMN_GAP}${mark}`,
    stream: record.stream,
  });
  return `${column}${COLUMN_GAP}${record._msg.replace(TERMINATOR, '')}${gap}`;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const OFFSET_DIGITS = 2;

/** Through the milliseconds, which is as fine as the agent stamps one. */
const RFC3339_LENGTH = 23;

/**
 * The instant the store recorded, as RFC 3339 in the reader's own timezone.
 *
 * Local rather than UTC because someone following their app is reading it against the clock on
 * their own wall, and a stamp an hour off the one the dashboard shows reads as a different event.
 * The offset is what keeps that unambiguous, and what leaves the line parseable by anything
 * downstream — which the time of day alone was not.
 */
function stampOf(instant: string): string {
  const at = new Date(instant);
  const offset = -at.getTimezoneOffset();
  const local = new Date(at.getTime() + offset * MS_PER_MINUTE);
  return `${local.toISOString().slice(0, RFC3339_LENGTH)}${offsetOf(offset)}`;
}

function offsetOf(minutes: number): string {
  if (minutes === 0) {
    return 'Z';
  }
  const size = Math.abs(minutes);
  const hours = twoDigits(Math.floor(size / MINUTES_PER_HOUR));
  return `${minutes < 0 ? '-' : '+'}${hours}:${twoDigits(size % MINUTES_PER_HOUR)}`;
}

function twoDigits(value: number): string {
  return String(value).padStart(OFFSET_DIGITS, '0');
}

const DIM = '\x1b[2m';
const UNDIM = '\x1b[22m';

/**
 * Dimming for the part of a line the app did not write.
 *
 * `print` styles a whole message, so a column that is only part of one has to arrive already
 * dimmed — and dimmed on the same terms `print` decides colour on, or a redirected stdout carries
 * escapes nobody asked for. Each stream answers for itself: they go to different places, and only
 * one of them may be a terminal.
 */
function dimmed({ text, stream }: { text: string; stream: TenantLogStream }): string {
  return coloured(stream) ? `${DIM}${text}${UNDIM}` : text;
}

function coloured(stream: TenantLogStream): boolean {
  const { NO_COLOR, FORCE_COLOR } = process.env;
  if (NO_COLOR) {
    return false;
  }
  if (FORCE_COLOR === '0' || FORCE_COLOR === 'false') {
    return false;
  }
  if (FORCE_COLOR) {
    return true;
  }
  return Boolean(stream === 'stderr' ? process.stderr.isTTY : process.stdout.isTTY);
}

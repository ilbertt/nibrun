import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { followLogs } from '@repo/app-operations';
import { TENANT_LOG_STREAMS, type TenantLogRecord, type TenantLogStream } from '@repo/protocol';
import { z } from 'zod';
import { defineOutput } from '#lib/output.ts';

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

/**
 * One record, as much of it as a reader has any use for. The keys the store needs to tell a
 * second copy from a second record are not among them: they are how the stream is assembled, and
 * what arrives here is already assembled.
 */
const LogRecordSchema = z.object({
  time: z.string(),
  stream: z.enum(TENANT_LOG_STREAMS),
  message: z.string(),
  /** How much output the host had to drop, for a record that stands for a gap rather than a line. */
  droppedBytes: z.number().nullable(),
});

export type LogRecord = z.infer<typeof LogRecordSchema>;

/**
 * Which stream a record came out of decides which one it goes back into, the way `docker logs`
 * does it: the app's error output is this program's error output, so `2>` and `>` separate them
 * again downstream. Under `--json` they arrive together and `stream` is what separates them,
 * which is the same distinction said in a way a program can read.
 */
export const LOG_RECORD_OUTPUT = defineOutput({
  schema: LogRecordSchema,
  render: ({ value, out }) => {
    const line = render(value);
    if (value.droppedBytes !== null) {
      out.warn(line);
      return;
    }
    if (value.stream === 'stderr') {
      out.error(line);
      return;
    }
    out.info(line);
  },
});

export type FollowInput = {
  api: PublicApiClient;
  appId: string;
  deploymentId: string;
  timerange: string;
  /** Whether there is a microVM to write anything more, which is what makes this a wait at all. */
  following: boolean;
  emit: (record: LogRecord) => void;
  print: Print;
  signal: AbortSignal;
};

/**
 * Hand over what a deployment has written, and keep handing over what it writes until stopped.
 *
 * An app with nothing running is not waited on: what it wrote is printed and that is the end of
 * it, said beside the output so a log that stops is not read as one that was cut off.
 */
export async function follow({
  api,
  appId,
  deploymentId,
  timerange,
  following,
  emit,
  print,
  signal,
}: FollowInput): Promise<void> {
  for await (const record of followLogs({
    api,
    appId,
    deploymentId,
    timerange,
    following,
    signal,
  })) {
    emit(asRecord(record));
  }
  if (!following) {
    print.dim('nothing is running, so that is everything it wrote');
  }
}

function asRecord(record: TenantLogRecord): LogRecord {
  return {
    time: record._time,
    stream: record.stream,
    message: record._msg,
    droppedBytes: record.droppedBytes ?? null,
  };
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
export function render(record: LogRecord): string {
  const gap = record.droppedBytes === null ? '' : ` (${record.droppedBytes} bytes)`;
  const mark = record.stream === 'stderr' ? 'err' : 'out';
  const column = dimmed({
    text: `${stampOf(record.time)}${COLUMN_GAP}${mark}`,
    stream: record.stream,
  });
  return `${column}${COLUMN_GAP}${record.message.replace(TERMINATOR, '')}${gap}`;
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

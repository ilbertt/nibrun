import { Buffer } from 'node:buffer';
import {
  type CronJobDefinition,
  CronJobDefinitionSchema,
  MAX_CRON_ENVIRONMENT_VARIABLES,
  MAX_CRONTAB_BYTES,
  type TenantLogStream,
  Value,
} from '@repo/protocol';
import { Data, Either, Option } from 'effect';

// NBR1 and its acknowledgement match apps/runtime/src/guest-cron.h.
export const GUEST_CRON_VSOCK_PORT = 51004;
const ACKNOWLEDGEMENT_BYTE = 0x06;
export const GUEST_CRON_ACK = Buffer.of(ACKNOWLEDGEMENT_BYTE);

const MAGIC = Buffer.from('NBR1');
const CODE_OFFSET = MAGIC.byteLength;
const LENGTH_OFFSET = CODE_OFFSET + 1;
const UINT32_BYTES = 4;
const HEADER_BYTES = LENGTH_OFFSET + UINT32_BYTES;
const OUTPUT_MAX_BYTES = 4096;
const REQUEST_MAX_BYTES = MAX_CRONTAB_BYTES + (MAX_CRON_ENVIRONMENT_VARIABLES + 2) * UINT32_BYTES;
const CONNECT_REPLY_MAX_BYTES = 64;
const UINT32_MAX = 0xffff_ffff;
const EXIT_CODE_MAX = 255;
const SIGNAL_MAX = 64;
const RUN_CODE = 0;
const CODES = { started: 1, stdout: 2, stderr: 3, exit: 4, rejected: 5 } as const;
const REFUSALS = {
  malformed: { code: 1, message: 'The guest rejected the cron command request.' },
  spawnFailed: { code: 2, message: 'The guest could not start the cron command.' },
  busy: { code: 3, message: 'The guest has no available cron execution worker.' },
} as const;

export type CronExitStatus = { readonly exitCode: number; readonly signal: number | undefined };
export type CronExecutionEvent =
  | { readonly kind: 'started' }
  | { readonly kind: 'output'; readonly stream: TenantLogStream; readonly bytes: Uint8Array };
export type CronExecutionReply =
  | CronExecutionEvent
  | { readonly kind: 'exit'; readonly status: CronExitStatus }
  | { readonly kind: 'rejected'; readonly reason: keyof typeof REFUSALS };

export class InvalidCronExecutionRequest extends Data.TaggedError('InvalidCronExecutionRequest') {
  override get message() {
    return 'The cron command does not fit the guest execution protocol.';
  }
}

export class MalformedCronExecutionReply extends Data.TaggedError('MalformedCronExecutionReply') {
  override get message() {
    return 'The guest sent a malformed cron execution reply.';
  }
}

export class CronExecutionRejected extends Data.TaggedError('CronExecutionRejected')<{
  readonly reason: keyof typeof REFUSALS;
}> {
  override get message() {
    return REFUSALS[this.reason].message;
  }
}

function field(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(UINT32_BYTES);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

export function encodeCronExecution(job: CronJobDefinition) {
  if (!Value.Check(CronJobDefinitionSchema, job)) {
    return Either.left(new InvalidCronExecutionRequest());
  }
  const entries = Object.entries(job.environment ?? {}).map(([name, value]) => `${name}=${value}`);
  const texts = [job.command, ...entries];
  let length = UINT32_BYTES;
  for (const text of texts) {
    length += UINT32_BYTES + Buffer.byteLength(text, 'utf8');
  }
  if (length > REQUEST_MAX_BYTES) {
    return Either.left(new InvalidCronExecutionRequest());
  }
  const count = Buffer.alloc(UINT32_BYTES);
  count.writeUInt32BE(entries.length);
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  header[CODE_OFFSET] = RUN_CODE;
  header.writeUInt32BE(length, LENGTH_OFFSET);
  return Either.right(Buffer.concat([header, field(job.command), count, ...entries.map(field)]));
}

export function decodeCronConnect({ buffered, chunk }: { buffered: Buffer; chunk: Uint8Array }) {
  if (buffered.byteLength + chunk.byteLength > CONNECT_REPLY_MAX_BYTES) {
    return Either.left(new MalformedCronExecutionReply());
  }
  const bytes = Buffer.concat([buffered, chunk]);
  const newline = bytes.indexOf('\n');
  if (newline < 0) {
    return Either.right({ buffered: bytes, connected: false });
  }
  const line = bytes.subarray(0, newline).toString('utf8');
  const port = Number(line.slice('OK '.length));
  if (
    newline !== bytes.byteLength - 1 ||
    !/^OK [0-9]{1,10}$/.test(line) ||
    port < 1 ||
    port > UINT32_MAX
  ) {
    return Either.left(new MalformedCronExecutionReply());
  }
  return Either.right({ buffered: Buffer.alloc(0), connected: true });
}

function validBodyLength({ code, length }: { code: number | undefined; length: number }) {
  switch (code) {
    case CODES.started:
      return length === 0;
    case CODES.stdout:
    case CODES.stderr:
      return length > 0 && length <= OUTPUT_MAX_BYTES;
    case CODES.exit:
      return length === UINT32_BYTES * 2;
    case CODES.rejected:
      return length === 1;
    default:
      return false;
  }
}

function exitStatus(body: Buffer) {
  const exitCode = body.readUInt32BE();
  const signal = body.readUInt32BE(UINT32_BYTES);
  return exitCode > EXIT_CODE_MAX || signal > SIGNAL_MAX || (signal !== 0 && exitCode !== 0)
    ? Either.left(new MalformedCronExecutionReply())
    : Either.right({ exitCode, signal: signal === 0 ? undefined : signal });
}

function replyFrom({ code, body }: { code: number | undefined; body: Buffer }) {
  switch (code) {
    case CODES.started:
      return Either.right({ kind: 'started' } as const);
    case CODES.stdout:
    case CODES.stderr:
      return Either.right({
        kind: 'output',
        stream: code === CODES.stdout ? 'stdout' : 'stderr',
        bytes: Uint8Array.from(body),
      } as const);
    case CODES.exit:
      return Either.map(exitStatus(body), (status) => ({ kind: 'exit', status }) as const);
    default: {
      const reason = Object.entries(REFUSALS).find(([, refusal]) => refusal.code === body[0])?.[0];
      return reason === undefined
        ? Either.left(new MalformedCronExecutionReply())
        : Either.right({ kind: 'rejected', reason: reason as keyof typeof REFUSALS } as const);
    }
  }
}

export function decodeCronExecution({ buffered, chunk }: { buffered: Buffer; chunk: Uint8Array }) {
  return Either.gen(function* () {
    if (buffered.byteLength + chunk.byteLength > HEADER_BYTES + OUTPUT_MAX_BYTES) {
      return yield* Either.left(new MalformedCronExecutionReply());
    }
    const bytes = Buffer.concat([buffered, chunk]);
    if (bytes.byteLength < HEADER_BYTES) {
      return { buffered: bytes, reply: Option.none<CronExecutionReply>() };
    }
    const length = bytes.readUInt32BE(LENGTH_OFFSET);
    const code = bytes[CODE_OFFSET];
    if (!bytes.subarray(0, MAGIC.byteLength).equals(MAGIC) || !validBodyLength({ code, length })) {
      return yield* Either.left(new MalformedCronExecutionReply());
    }
    if (bytes.byteLength < HEADER_BYTES + length) {
      return { buffered: bytes, reply: Option.none<CronExecutionReply>() };
    }
    // Another frame before our acknowledgement violates the output bound.
    if (bytes.byteLength !== HEADER_BYTES + length) {
      return yield* Either.left(new MalformedCronExecutionReply());
    }
    const reply = yield* replyFrom({ code, body: bytes.subarray(HEADER_BYTES) });
    return { buffered: Buffer.alloc(0), reply: Option.some<CronExecutionReply>(reply) };
  });
}

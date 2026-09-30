import { Buffer } from 'node:buffer';
import { MAX_CRONTAB_BYTES } from '@repo/protocol';
import { Data, Either, Option } from 'effect';
import { guestVsockPath } from '#lib/vm/vsock.ts';

export const CRON_REGISTRATION_VSOCK_PORT = 51003;
export const CRON_REGISTRATION_VERBS = { replace: 1, list: 2 } as const;
export const CRON_REGISTRATION_STATUS = { ok: 0, rejected: 1 } as const;
export const CRON_REGISTRATION_HEADER_BYTES = 9;

const MAGIC = Buffer.from('NBC1');
const CODE_OFFSET = MAGIC.byteLength;
const LENGTH_OFFSET = CODE_OFFSET + 1;

export type CronRegistrationRequest = {
  readonly verb: keyof typeof CRON_REGISTRATION_VERBS;
  readonly text: string;
};

export class MalformedCronRegistration extends Data.TaggedError('MalformedCronRegistration') {
  override get message() {
    return 'The guest sent a malformed cron registration request.';
  }
}

export function cronRegistrationSocketPath({ workingDir }: { workingDir: string }) {
  return `${guestVsockPath({ workingDir })}_${CRON_REGISTRATION_VSOCK_PORT}`;
}

export function cronRegistrationReply({
  status,
  text,
}: {
  status: keyof typeof CRON_REGISTRATION_STATUS;
  text: string;
}) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(CRON_REGISTRATION_HEADER_BYTES);
  MAGIC.copy(header);
  header[CODE_OFFSET] = CRON_REGISTRATION_STATUS[status];
  header.writeUInt32BE(body.byteLength, LENGTH_OFFSET);
  return Buffer.concat([header, body]);
}

export function decodeCronRegistration({
  buffered,
  chunk,
}: {
  buffered: Buffer;
  chunk: Uint8Array;
}) {
  return Either.gen(function* () {
    if (
      buffered.byteLength + chunk.byteLength >
      CRON_REGISTRATION_HEADER_BYTES + MAX_CRONTAB_BYTES
    ) {
      return yield* Either.left(new MalformedCronRegistration());
    }
    const bytes = Buffer.concat([buffered, chunk]);
    if (bytes.byteLength < CRON_REGISTRATION_HEADER_BYTES) {
      return { buffered: bytes, request: Option.none<CronRegistrationRequest>() };
    }
    const length = bytes.readUInt32BE(LENGTH_OFFSET);
    const verb = Object.entries(CRON_REGISTRATION_VERBS).find(
      ([, code]) => code === bytes[CODE_OFFSET],
    )?.[0] as CronRegistrationRequest['verb'] | undefined;
    if (
      !bytes.subarray(0, MAGIC.byteLength).equals(MAGIC) ||
      length > MAX_CRONTAB_BYTES ||
      verb === undefined ||
      (verb === 'list' && length !== 0)
    ) {
      return yield* Either.left(new MalformedCronRegistration());
    }
    const total = CRON_REGISTRATION_HEADER_BYTES + length;
    if (bytes.byteLength < total) {
      return { buffered: bytes, request: Option.none<CronRegistrationRequest>() };
    }
    if (bytes.byteLength !== total) {
      return yield* Either.left(new MalformedCronRegistration());
    }
    const text = yield* Either.try({
      try: () =>
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          bytes.subarray(CRON_REGISTRATION_HEADER_BYTES),
        ),
      catch: () => new MalformedCronRegistration(),
    });
    return { buffered: Buffer.alloc(0), request: Option.some({ verb, text }) };
  });
}

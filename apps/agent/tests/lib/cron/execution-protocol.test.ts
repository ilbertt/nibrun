import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Value } from '@sinclair/typebox/value';
import { Either, Option } from 'effect';
import {
  decodeCronConnect,
  decodeCronExecution,
  encodeCronExecution,
} from '#lib/cron/execution-protocol.ts';
import { CronJobDefinitionSchema, MAX_CRONTAB_BYTES } from '#lib/cron/model.ts';
import {
  CRON_HEADER_BYTES,
  CRON_LENGTH_OFFSET,
  CRON_REPLY,
  CRON_UINT32_BYTES,
  cronExitFrame,
  cronReplyFrame,
  cronRequestContents,
} from '#tests/support/cron-execution.ts';

const OUTPUT_LIMIT_BYTES = 4096;
const CONNECT_LIMIT_BYTES = 64;
const EXIT_CODE_LIMIT = 255;
const SIGNAL_LIMIT = 64;
const UNKNOWN_CODE = 99;
const ENVIRONMENT_OVERFLOW_BYTES = 2000;
const REQUEST_LENGTH_FIELDS = 3;

describe('cron execution framing', () => {
  test('encodes UTF-8 byte lengths and literal environment values', () => {
    const encoded = encodeCronExecution(
      Value.Parse(CronJobDefinitionSchema, {
        schedule: '@hourly',
        command: 'printf héllo',
        environment: { VALUE: '$literal héllo' },
      }),
    );
    expect(Either.isRight(encoded)).toBe(true);
    if (Either.isRight(encoded)) {
      const bytes = encoded.right;
      const command = Buffer.from('printf héllo');
      const entry = Buffer.from('VALUE=$literal héllo');
      expect(bytes.readUInt32BE(CRON_LENGTH_OFFSET)).toBe(
        CRON_UINT32_BYTES * REQUEST_LENGTH_FIELDS + command.byteLength + entry.byteLength,
      );
      expect(bytes.readUInt32BE(CRON_HEADER_BYTES)).toBe(command.byteLength);
      expect(cronRequestContents(bytes)).toEqual({
        magic: 'NBR1',
        code: 0,
        command: command.toString(),
        environment: [entry.toString()],
        trailing: 0,
      });
    }
  });

  test('rejects schema-invalid commands and a valid job whose environment exceeds one request', () => {
    const invalid = { schedule: '@hourly', command: '', environment: {} };
    expect(Either.isLeft(encodeCronExecution(invalid))).toBe(true);
    const job = Value.Parse(CronJobDefinitionSchema, {
      schedule: '@hourly',
      command: 'exit 0',
      environment: {
        ONE: 'x'.repeat(MAX_CRONTAB_BYTES / 2),
        TWO: 'x'.repeat(MAX_CRONTAB_BYTES / 2),
      },
    });
    expect(Either.isLeft(encodeCronExecution(job))).toBe(false);
    const tooLarge = {
      ...job,
      environment: { ...job.environment, THREE: 'x'.repeat(ENVIRONMENT_OVERFLOW_BYTES) },
    };
    expect(Either.isLeft(encodeCronExecution(Value.Parse(CronJobDefinitionSchema, tooLarge)))).toBe(
      true,
    );
  });

  test('a reply survives every byte boundary including non-ASCII output', () => {
    const frame = cronReplyFrame({ code: 2, body: Buffer.from('héllo\0world') });
    let buffered = Buffer.alloc(0);
    for (const [index, byte] of frame.entries()) {
      const decoded = decodeCronExecution({ buffered, chunk: Buffer.of(byte) });
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        buffered = decoded.right.buffered;
        expect(Option.isSome(decoded.right.reply)).toBe(index === frame.byteLength - 1);
        if (Option.isSome(decoded.right.reply)) {
          expect(decoded.right.reply.value).toEqual({
            kind: 'output',
            stream: 'stdout',
            bytes: Uint8Array.from(Buffer.from('héllo\0world')),
          });
        }
      }
    }
    expect(buffered).toHaveLength(0);
  });

  test('reads distinct exit codes and termination signals', () => {
    for (const status of [
      { exitCode: 7, signal: 0 },
      { exitCode: 0, signal: 15 },
    ]) {
      const decoded = decodeCronExecution({
        buffered: Buffer.alloc(0),
        chunk: cronExitFrame(status),
      });
      expect(Either.isRight(decoded) && Option.getOrUndefined(decoded.right.reply)).toEqual({
        kind: 'exit',
        status: {
          exitCode: status.exitCode,
          signal: status.signal === 0 ? undefined : status.signal,
        },
      });
    }
  });

  test('rejects invalid headers, payload lengths, exit status, and extra frames', () => {
    const oversized = cronReplyFrame({
      code: CRON_REPLY.stdout,
      body: Buffer.alloc(OUTPUT_LIMIT_BYTES + 1),
    });
    const badMagic = cronReplyFrame({ code: 1, body: Buffer.alloc(0) });
    badMagic[0] = 0;
    const started = cronReplyFrame({ code: 1, body: Buffer.alloc(0) });
    for (const frame of [
      oversized,
      badMagic,
      Buffer.concat([started, started]),
      cronReplyFrame({ code: 99, body: Buffer.alloc(0) }),
      cronReplyFrame({ code: 1, body: Buffer.of(0) }),
      cronReplyFrame({ code: 2, body: Buffer.alloc(0) }),
      cronReplyFrame({ code: CRON_REPLY.exit, body: Buffer.alloc(CRON_UINT32_BYTES) }),
      cronReplyFrame({ code: CRON_REPLY.rejected, body: Buffer.of(UNKNOWN_CODE) }),
      cronExitFrame({ exitCode: EXIT_CODE_LIMIT + 1, signal: 0 }),
      cronExitFrame({ exitCode: 0, signal: SIGNAL_LIMIT + 1 }),
      cronExitFrame({ exitCode: 7, signal: 15 }),
    ]) {
      expect(Either.isLeft(decodeCronExecution({ buffered: Buffer.alloc(0), chunk: frame }))).toBe(
        true,
      );
    }
  });

  test('bounds the Firecracker handshake and requires one complete valid reply', () => {
    const partial = decodeCronConnect({ buffered: Buffer.alloc(0), chunk: Buffer.from('OK 10') });
    expect(Either.isRight(partial) && partial.right.connected).toBe(false);
    expect(
      decodeCronConnect({ buffered: Buffer.from('OK 10'), chunk: Buffer.from('24\n') }),
    ).toEqual(Either.right({ buffered: Buffer.alloc(0), connected: true }));
    for (const reply of [
      'ERR secret\n',
      'OK 0\n',
      'OK 4294967296\n',
      'OK nope\n',
      'OK 1024\nextra',
      'x'.repeat(CONNECT_LIMIT_BYTES + 1),
    ]) {
      expect(
        Either.isLeft(decodeCronConnect({ buffered: Buffer.alloc(0), chunk: Buffer.from(reply) })),
      ).toBe(true);
    }
  });
});

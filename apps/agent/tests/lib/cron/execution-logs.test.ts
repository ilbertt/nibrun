import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  CronJobDefinitionSchema,
  CronJobIdSchema,
  CronRunIdSchema,
  TenantLogRecordSchema,
  Value,
} from '@repo/protocol';
import { Deferred, Effect, Fiber, Layer, Logger } from 'effect';
import { makeCronRunLogs, runLoggedGuestCron } from '#lib/cron/execution-logs.ts';
import { CronExecutionDisconnected } from '#lib/cron/execution-session.ts';
import type { TenantLogEvent } from '#lib/logs/event.ts';
import { makeLogStoreClient } from '#lib/logs/store-client.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';
import {
  CRON_REPLY,
  cronExitFrame,
  cronGuestScript,
  cronReplyFrame,
  servingCronGuest,
} from '#tests/support/cron-execution.ts';
import { HOST_ID, LOG_SOURCE } from '#tests/support/fixtures.ts';
import { drainedEvents } from '#tests/support/logs.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { recordingServer } from '#tests/support/server.ts';

const run = provided(
  Layer.mergeAll(
    platform,
    TenantLogQueue.Default,
    Logger.replace(Logger.defaultLogger, Logger.none),
  ),
);
const CONTEXT = {
  ...LOG_SOURCE,
  cronJobId: Value.Parse(CronJobIdSchema, 'cron-job-1'),
  cronRunId: Value.Parse(CronRunIdSchema, 'cron-run-1'),
};
const SECOND_RUN_ID = Value.Parse(CronRunIdSchema, 'cron-run-2');
const START_AND_TWO_OUTPUT_ACKNOWLEDGEMENTS = 3;
const EMOJI_SPLIT_OFFSET = 2;
const EMOJI = Buffer.from('😀');
const EMOJI_PREFIX = EMOJI.subarray(0, EMOJI_SPLIT_OFFSET);
const EMOJI_SUFFIX_WITH_NUL = Buffer.concat([
  EMOJI.subarray(EMOJI_SPLIT_OFFSET),
  Buffer.from('\0'),
]);
const ACCENT = Buffer.from('é');
const ACCENT_PREFIX = ACCENT.subarray(0, 1);
const ACCENT_SUFFIX = ACCENT.subarray(1);
const INCOMPLETE_EURO = Buffer.from('€').subarray(0, 1);
const JOB = Value.Parse(CronJobDefinitionSchema, {
  schedule: '@hourly',
  command: 'printf output',
});

function output({ stream, bytes }: { stream: 'stdout' | 'stderr'; bytes: Uint8Array }) {
  return { kind: 'output', stream, bytes } as const;
}

function messages(events: readonly TenantLogEvent[]) {
  return events.map((event) => (event.kind === 'data' ? [event.stream, event.text] : event.kind));
}

describe('cron execution logs', () => {
  test('decodes split UTF-8 independently for stdout and stderr', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const logs = yield* makeCronRunLogs(CONTEXT);
        yield* logs.consume({ kind: 'started' });
        yield* logs.consume(output({ stream: 'stdout', bytes: EMOJI_PREFIX }));
        yield* logs.consume(output({ stream: 'stderr', bytes: ACCENT_PREFIX }));
        expect(yield* queue.isEmpty).toBe(true);
        yield* logs.consume(output({ stream: 'stderr', bytes: ACCENT_SUFFIX }));
        yield* logs.consume(output({ stream: 'stdout', bytes: EMOJI_SUFFIX_WITH_NUL }));
        yield* logs.flush;
        const events = yield* drainedEvents(queue);
        expect(messages(events)).toEqual([
          ['stderr', 'é'],
          ['stdout', '😀\0'],
        ]);
        expect(events.map((event) => event.sequence)).toEqual([0, 1]);
        expect(new Set(events.map((event) => event.sourceId)).size).toBe(1);
        for (const event of events) {
          expect(event).toMatchObject(CONTEXT);
        }
      }),
    ));

  test('overlapping runs have independent decoder and deduplication state', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const first = yield* makeCronRunLogs(CONTEXT);
        const second = yield* makeCronRunLogs({
          ...CONTEXT,
          cronRunId: SECOND_RUN_ID,
        });
        yield* first.consume(output({ stream: 'stdout', bytes: ACCENT_PREFIX }));
        yield* second.consume(output({ stream: 'stdout', bytes: Buffer.from('A') }));
        yield* first.consume(output({ stream: 'stdout', bytes: ACCENT_SUFFIX }));
        yield* second.consume(output({ stream: 'stderr', bytes: Buffer.from('B') }));
        const events = yield* drainedEvents(queue);
        expect(messages(events)).toEqual([
          ['stdout', 'A'],
          ['stdout', 'é'],
          ['stderr', 'B'],
        ]);
        expect(events.map((event) => event.sequence)).toEqual([0, 0, 1]);
        expect(events.map((event) => event.cronRunId)).toEqual([
          SECOND_RUN_ID,
          CONTEXT.cronRunId,
          SECOND_RUN_ID,
        ]);
        expect(events[0]?.sourceId).toBe(events[2]?.sourceId);
        expect(events[0]?.sourceId).not.toBe(events[1]?.sourceId);
      }),
    ));

  test('refused output leaves a sequence gap without failing its consumer', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const stub = TenantLogQueue.make({
          ...queue,
          publish: (event) => (event.sequence === 1 ? Effect.succeed(false) : queue.publish(event)),
        });
        const logs = yield* makeCronRunLogs(CONTEXT).pipe(
          Effect.provideService(TenantLogQueue, stub),
        );
        for (const byte of Buffer.from('ABC')) {
          yield* logs.consume(output({ stream: 'stdout', bytes: Buffer.of(byte) }));
        }
        const events = yield* drainedEvents(queue);
        expect(messages(events)).toEqual([
          ['stdout', 'A'],
          ['stdout', 'C'],
        ]);
        expect(events.map((event) => event.sequence)).toEqual([0, 2]);
      }),
    ));

  test('flush emits incomplete characters once', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const logs = yield* makeCronRunLogs(CONTEXT);
        yield* logs.consume(output({ stream: 'stdout', bytes: INCOMPLETE_EURO }));
        yield* logs.consume(output({ stream: 'stderr', bytes: EMOJI_PREFIX }));
        yield* logs.flush;
        yield* logs.flush;
        expect(messages(yield* drainedEvents(queue))).toEqual([
          ['stdout', '�'],
          ['stderr', '�'],
        ]);
      }),
    ));

  test('streams a nonzero command exit through the existing VictoriaLogs uploader', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('output\n') }),
              cronReplyFrame({ code: CRON_REPLY.stderr, body: ACCENT_PREFIX }),
              cronExitFrame({ exitCode: 7, signal: 0 }),
            ],
          }),
        });
        expect(
          yield* runLoggedGuestCron({ socketPath: guest.socketPath, job: JOB, context: CONTEXT }),
        ).toEqual({ exitCode: 7, signal: undefined });
        const server = yield* recordingServer({});
        yield* makeLogStoreClient({ baseUrl: server.baseUrl }).publish({
          events: yield* drainedEvents(queue),
          hostId: HOST_ID,
        });
        const records = (server.received[0]?.body ?? '')
          .trim()
          .split('\n')
          .map((line) => Value.Parse(TenantLogRecordSchema, JSON.parse(line)));
        expect(records.map((record) => [record.stream, record._msg])).toEqual([
          ['stdout', 'output\n'],
          ['stderr', '�'],
        ]);
        for (const record of records) {
          expect(record).toMatchObject({ ...CONTEXT, hostId: HOST_ID, SOURCE: 'tenant' });
        }
      }),
    ));

  test('a disconnected command flushes its pending UTF-8 before returning the error', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: INCOMPLETE_EURO }),
            ],
          }),
        });
        expect(
          yield* runLoggedGuestCron({
            socketPath: guest.socketPath,
            job: JOB,
            context: CONTEXT,
          }).pipe(Effect.flip),
        ).toBeInstanceOf(CronExecutionDisconnected);
        expect(messages(yield* drainedEvents(queue))).toEqual([['stdout', '�']]);
      }),
    ));

  test('a full upload buffer still acknowledges output and lets the command finish', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const stub = TenantLogQueue.make({ ...queue, publish: () => Effect.succeed(false) });
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('dropped stdout') }),
              cronReplyFrame({ code: CRON_REPLY.stderr, body: Buffer.from('dropped stderr') }),
              cronExitFrame({ exitCode: 0, signal: 0 }),
            ],
          }),
        });
        expect(
          yield* runLoggedGuestCron({
            socketPath: guest.socketPath,
            job: JOB,
            context: CONTEXT,
          }).pipe(Effect.provideService(TenantLogQueue, stub)),
        ).toEqual({ exitCode: 0, signal: undefined });
        expect(guest.acknowledgements).toHaveLength(START_AND_TWO_OUTPUT_ACKNOWLEDGEMENTS);
        expect(yield* queue.isEmpty).toBe(true);
      }),
    ));

  test('cancellation closes the command connection and flushes buffered characters', () =>
    run(
      Effect.gen(function* () {
        const queue = yield* TenantLogQueue;
        const received = yield* Deferred.make<void>();
        const stub = TenantLogQueue.make({
          ...queue,
          publish: (event) =>
            queue.publish(event).pipe(Effect.tap(() => Deferred.succeed(received, undefined))),
        });
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            closeAfterFrames: false,
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({
                code: CRON_REPLY.stdout,
                body: Buffer.concat([Buffer.from('A'), INCOMPLETE_EURO]),
              }),
            ],
          }),
        });
        const execution = yield* runLoggedGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          context: CONTEXT,
        }).pipe(Effect.provideService(TenantLogQueue, stub), Effect.forkScoped);
        yield* Deferred.await(received);
        yield* Fiber.interrupt(execution);
        yield* Effect.promise(() => guest.closed);
        expect(messages(yield* drainedEvents(queue))).toEqual([
          ['stdout', 'A'],
          ['stdout', '�'],
        ]);
      }),
    ));
});

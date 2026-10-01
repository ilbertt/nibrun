import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { CronJobDefinitionSchema, Value } from '@repo/protocol';
import { Deferred, Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import { runGuestCron } from '#lib/cron/execution-client.ts';
import {
  type CronExecutionEvent,
  CronExecutionRejected,
  MalformedCronExecutionReply,
} from '#lib/cron/execution-protocol.ts';
import { CronExecutionDisconnected } from '#lib/cron/execution-session.ts';
import {
  CRON_REPLY,
  cronExitFrame,
  cronGuestScript,
  cronReplyFrame,
  servingCronGuest,
} from '#tests/support/cron-execution.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const JOB = Value.Parse(CronJobDefinitionSchema, {
  schedule: '@hourly',
  command: 'printf héllo',
  environment: { VALUE: '$literal "quoted" héllo' },
});
const ACKNOWLEDGEMENT_BYTE = 0x06;
const BUSY_REJECTION_CODE = 3;
const PAST_REPLY_DEADLINE_SECONDS = 6;

describe('guest cron execution client', () => {
  test('streams fragmented output and returns an exit status before the peer closes', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            fragmented: true,
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('héllo\0world') }),
              cronReplyFrame({ code: CRON_REPLY.stderr, body: Buffer.from('error héllo') }),
              cronExitFrame({ exitCode: 7, signal: 0 }),
            ],
          }),
        });
        const events: CronExecutionEvent[] = [];
        const status = yield* runGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          onEvent: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        });
        expect(status).toEqual({ exitCode: 7, signal: undefined });
        expect(events).toEqual([
          { kind: 'started' },
          { kind: 'output', stream: 'stdout', bytes: Uint8Array.from(Buffer.from('héllo\0world')) },
          { kind: 'output', stream: 'stderr', bytes: Uint8Array.from(Buffer.from('error héllo')) },
        ]);
        expect(guest.connectRequests).toEqual(['CONNECT 51004\n']);
        expect(guest.received).toEqual([
          {
            magic: 'NBR1',
            code: 0,
            command: JOB.command,
            environment: ['VALUE=$literal "quoted" héllo'],
            trailing: 0,
          },
        ]);
        expect(guest.acknowledgements).toEqual([
          ACKNOWLEDGEMENT_BYTE,
          ACKNOWLEDGEMENT_BYTE,
          ACKNOWLEDGEMENT_BYTE,
        ]);
        yield* Effect.promise(() => guest.closed);
      }),
    ));

  test('acknowledges output only after its consumer finishes', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('held output') }),
              cronExitFrame({ exitCode: 0, signal: 15 }),
            ],
          }),
        });
        const received = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const execution = yield* runGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          onEvent: (event) =>
            event.kind === 'output'
              ? Deferred.succeed(received, undefined).pipe(Effect.zipRight(Deferred.await(release)))
              : Effect.void,
        }).pipe(Effect.forkScoped);
        yield* Deferred.await(received);
        expect(guest.acknowledgements).toEqual([ACKNOWLEDGEMENT_BYTE]);
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(execution)).toEqual({ exitCode: 0, signal: 15 });
        expect(guest.acknowledgements).toEqual([ACKNOWLEDGEMENT_BYTE, ACKNOWLEDGEMENT_BYTE]);
      }),
    ));

  test('a peer disconnect interrupts a blocked output consumer', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            closeAfterFrames: false,
            frames: [
              cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) }),
              cronReplyFrame({ code: CRON_REPLY.stdout, body: Buffer.from('held output') }),
            ],
          }),
        });
        const received = yield* Deferred.make<void>();
        const execution = yield* runGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          onEvent: (event) =>
            event.kind === 'output'
              ? Deferred.succeed(received, undefined).pipe(Effect.zipRight(Effect.never))
              : Effect.void,
        }).pipe(Effect.flip, Effect.forkScoped);
        yield* Deferred.await(received);
        yield* Effect.sync(guest.disconnect);
        expect(yield* Fiber.join(execution)).toBeInstanceOf(CronExecutionDisconnected);
      }),
    ));

  test('interrupting a silent running command closes its connection', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            closeAfterFrames: false,
            frames: [cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) })],
          }),
        });
        const started = yield* Deferred.make<void>();
        const execution = yield* runGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          onEvent: () => Effect.asVoid(Deferred.succeed(started, undefined)),
        }).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(execution);
        yield* Effect.promise(() => guest.closed);
        expect(guest.received).toHaveLength(1);
      }),
    ));

  test('a consumer failure closes the connection without retrying', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({ closeAfterFrames: false }),
        });
        const failure = yield* Effect.flip(
          runGuestCron({
            socketPath: guest.socketPath,
            job: JOB,
            onEvent: () => Effect.fail('consumer failed'),
          }),
        );
        expect(failure).toBe('consumer failed');
        yield* Effect.promise(() => guest.closed);
        expect(guest.received).toHaveLength(1);
        expect(guest.acknowledgements).toHaveLength(0);
      }),
    ));

  test('reports guest refusals without acknowledging or retrying', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [
              cronReplyFrame({ code: CRON_REPLY.rejected, body: Buffer.of(BUSY_REJECTION_CODE) }),
            ],
          }),
        });
        const failure = yield* Effect.flip(
          runGuestCron({
            socketPath: guest.socketPath,
            job: JOB,
            onEvent: () => Effect.die('a refused run cannot start'),
          }),
        );
        expect(failure).toEqual(new CronExecutionRejected({ reason: 'busy' }));
        expect(guest.received).toHaveLength(1);
        expect(guest.acknowledgements).toHaveLength(0);
      }),
    ));

  test('rejects an execution reply that skips the started frame', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({ frames: [cronExitFrame({ exitCode: 0, signal: 0 })] }),
        });
        const failure = yield* Effect.flip(
          runGuestCron({ socketPath: guest.socketPath, job: JOB, onEvent: () => Effect.void }),
        );
        expect(failure).toBeInstanceOf(MalformedCronExecutionReply);
      }),
    ));

  test('a close without exit status fails instead of reporting success', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({
            frames: [cronReplyFrame({ code: CRON_REPLY.started, body: Buffer.alloc(0) })],
          }),
        });
        const failure = yield* Effect.flip(
          runGuestCron({ socketPath: guest.socketPath, job: JOB, onEvent: () => Effect.void }),
        );
        expect(failure).toBeInstanceOf(CronExecutionDisconnected);
        expect(guest.received).toHaveLength(1);
      }),
    ));

  test('an unreachable socket fails without a run event', () =>
    run(
      Effect.gen(function* () {
        const socketPath = join(yield* temporaryDirectory, 'missing.vsock');
        const failure = yield* Effect.flip(
          runGuestCron({
            socketPath,
            job: JOB,
            onEvent: () => Effect.die('an unreachable guest cannot start'),
          }),
        );
        expect(failure).toBeInstanceOf(CronExecutionDisconnected);
      }),
    ));

  test('times out a silent Firecracker handshake using the Effect clock', () =>
    run(
      Effect.gen(function* () {
        const guest = yield* servingCronGuest({
          directory: yield* temporaryDirectory,
          script: cronGuestScript({ connectReply: '' }),
        });
        const execution = yield* runGuestCron({
          socketPath: guest.socketPath,
          job: JOB,
          onEvent: () => Effect.void,
        }).pipe(Effect.flip, Effect.forkScoped);
        yield* Effect.promise(() => guest.connected);
        yield* TestClock.adjust(Duration.seconds(PAST_REPLY_DEADLINE_SECONDS));
        expect(yield* Fiber.join(execution)).toBeInstanceOf(CronExecutionDisconnected);
        yield* Effect.promise(() => guest.closed);
        expect(guest.received).toHaveLength(0);
      }).pipe(Effect.provide(TestContext.TestContext)),
    ));
});

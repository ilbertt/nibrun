import { BunSocket } from '@effect/platform-bun';
import type { CronJobDefinition } from '@repo/protocol';
import { Cause, Deferred, Duration, Effect, Exit, Option } from 'effect';
import {
  type CronExecutionEvent,
  CronExecutionRejected,
  type CronExitStatus,
  encodeCronExecution,
  GUEST_CRON_ACK,
  GUEST_CRON_VSOCK_PORT,
  MalformedCronExecutionReply,
} from '#lib/cron/execution-protocol.ts';
import {
  CronExecutionDisconnected,
  type CronWireError,
  cronExecutionSession,
} from '#lib/cron/execution-session.ts';
import { connectRequest } from '#lib/vm/vsock.ts';

const RESPONSE_TIMEOUT_SECONDS = 5;
const RESPONSE_TIMEOUT = Duration.seconds(RESPONSE_TIMEOUT_SECONDS);

function readerFailure(exit: Exit.Exit<void, CronWireError>) {
  const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
  return Option.isSome(failure) ? failure.value : new CronExecutionDisconnected();
}

export function runGuestCron<E, R>({
  socketPath,
  job,
  onEvent,
}: {
  socketPath: string;
  job: CronJobDefinition;
  onEvent: (event: CronExecutionEvent) => Effect.Effect<void, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const request = yield* encodeCronExecution(job);
      const session = yield* cronExecutionSession;
      const opened = yield* Deferred.make<void, CronWireError>();
      const closed = yield* Deferred.make<never, CronWireError>();
      const socket = yield* BunSocket.makeNet({
        path: socketPath,
        openTimeout: RESPONSE_TIMEOUT,
      }).pipe(Effect.mapError(() => new CronExecutionDisconnected()));
      const write = yield* socket.writer;

      function sending(bytes: Uint8Array | string) {
        return write(bytes).pipe(
          Effect.mapError(() => new CronExecutionDisconnected()),
          Effect.timeoutFail({
            duration: RESPONSE_TIMEOUT,
            onTimeout: () => new CronExecutionDisconnected(),
          }),
        );
      }

      const firstReply = session.awaitEvent.pipe(
        Effect.timeoutFail({
          duration: RESPONSE_TIMEOUT,
          onTimeout: () => new CronExecutionDisconnected(),
        }),
      );
      yield* socket
        .run(session.receive, { onOpen: Effect.asVoid(Deferred.succeed(opened, undefined)) })
        .pipe(
          Effect.catchTag('SocketError', () => Effect.fail(new CronExecutionDisconnected())),
          Effect.onExit((exit) =>
            Effect.gen(function* () {
              const error = readerFailure(exit);
              yield* Deferred.fail(opened, error);
              yield* session.close(error);
              yield* Deferred.fail(closed, error);
            }),
          ),
          Effect.forkScoped,
        );
      yield* Deferred.await(opened);
      yield* sending(connectRequest(GUEST_CRON_VSOCK_PORT));
      if ((yield* firstReply).kind !== 'connected') {
        return yield* new MalformedCronExecutionReply();
      }
      yield* session.next;
      yield* sending(request);
      const started = yield* firstReply;
      if (started.kind === 'rejected') {
        return yield* new CronExecutionRejected({ reason: started.reason });
      }
      if (started.kind !== 'started') {
        return yield* new MalformedCronExecutionReply();
      }
      yield* onEvent(started).pipe(Effect.raceFirst(Deferred.await(closed)));
      yield* session.next;
      yield* sending(GUEST_CRON_ACK);
      for (;;) {
        const reply = yield* session.awaitEvent;
        if (reply.kind === 'exit') {
          return reply.status satisfies CronExitStatus;
        }
        if (reply.kind !== 'output') {
          return yield* new MalformedCronExecutionReply();
        }
        yield* onEvent(reply).pipe(Effect.raceFirst(Deferred.await(closed)));
        yield* session.next;
        yield* sending(GUEST_CRON_ACK);
      }
    }),
  );
}

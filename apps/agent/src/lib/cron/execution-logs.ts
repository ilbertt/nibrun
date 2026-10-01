import {
  type CronJobDefinition,
  TENANT_LOG_STREAMS,
  type TenantLogRecord,
  type TenantLogStream,
} from '@repo/protocol';
import { Effect, Ref } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import { runGuestCron } from '#lib/cron/execution-client.ts';
import type { CronExecutionEvent } from '#lib/cron/execution-protocol.ts';
import type { TenantLogSource } from '#lib/logs/vsock.ts';
import { TenantLogQueue } from '#services/tenant-log-queue.service.ts';

export type CronRunLogContext = TenantLogSource &
  Required<Pick<TenantLogRecord, 'cronJobId' | 'cronRunId'>>;

export function makeCronRunLogs(context: CronRunLogContext) {
  return Effect.gen(function* () {
    const logs = yield* TenantLogQueue;
    const sourceId = yield* Effect.sync(() => crypto.randomUUID());
    const sequence = yield* Ref.make(0);
    const droppedEvents = yield* Ref.make(0);
    const decoders: Record<TenantLogStream, TextDecoder> = {
      stdout: new TextDecoder(),
      stderr: new TextDecoder(),
    };

    function publish({ stream, text }: { stream: TenantLogStream; text: string }) {
      return Effect.gen(function* () {
        if (text.length === 0) {
          return;
        }
        const accepted = yield* logs.publish({
          ...context,
          sourceId,
          sequence: yield* Ref.getAndUpdate(sequence, (current) => current + 1),
          observedAt: yield* nowTimestamp,
          kind: 'data',
          stream,
          text,
        });
        if (!accepted) {
          const total = yield* Ref.updateAndGet(droppedEvents, (current) => current + 1);
          // Powers of two keep a full shared buffer from logging once per output frame.
          if ((total & (total - 1)) === 0) {
            yield* Effect.logWarning('cron log upload buffer full').pipe(
              Effect.annotateLogs({ ...context, droppedEvents: total }),
            );
          }
        }
      });
    }

    function consume(event: CronExecutionEvent) {
      return event.kind === 'started'
        ? Effect.void
        : Effect.flatMap(
            Effect.sync(() => decoders[event.stream].decode(event.bytes, { stream: true })),
            (text) => publish({ stream: event.stream, text }),
          );
    }

    const flush = Effect.forEach(
      TENANT_LOG_STREAMS,
      (stream) =>
        Effect.flatMap(
          Effect.sync(() => decoders[stream].decode()),
          (text) => publish({ stream, text }),
        ),
      { discard: true },
    );

    return { consume, flush };
  });
}

export function runLoggedGuestCron({
  socketPath,
  job,
  context,
}: {
  socketPath: string;
  job: CronJobDefinition;
  context: CronRunLogContext;
}) {
  return Effect.gen(function* () {
    const logs = yield* makeCronRunLogs(context);
    return yield* runGuestCron({ socketPath, job, onEvent: logs.consume }).pipe(
      Effect.ensuring(logs.flush),
    );
  });
}

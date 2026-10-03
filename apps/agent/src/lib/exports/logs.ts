import { FileSystem } from '@effect/platform';
import { ExportLogEventSchema, parseMessage } from '@repo/protocol';
import { Data, Effect } from 'effect';
import { decode } from '#lib/protocol.ts';

export const EXPORTED_LOGS_FILENAME = 'logs.jsonl';
const PRIVATE_LOG_MODE = 0o600;

export class ExportLogsIncomplete extends Data.TaggedError('ExportLogsIncomplete') {
  override get message() {
    return 'The app log export did not finish.';
  }
}

export function writeExportLogs({
  events,
  destination,
  cancel,
}: {
  events: AsyncIterable<unknown>;
  destination: string;
  cancel: Effect.Effect<void>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = yield* fs.open(destination, { flag: 'w', mode: PRIVATE_LOG_MODE });
      const iterator = yield* Effect.acquireRelease(
        Effect.sync(() => events[Symbol.asyncIterator]()),
        (current) =>
          // An async generator cannot return while its pending socket read is still waiting.
          cancel.pipe(Effect.andThen(Effect.promise(async () => current.return?.()))),
      );
      const encoder = new TextEncoder();
      let complete = false;
      let hasLogs = false;
      while (true) {
        const next = yield* Effect.tryPromise({
          try: () => iterator.next(),
          catch: () => new ExportLogsIncomplete(),
        });
        if (next.done) {
          break;
        }
        if (complete) {
          return yield* new ExportLogsIncomplete();
        }
        const event = yield* decode(() =>
          parseMessage({ schema: ExportLogEventSchema, value: next.value }),
        );
        if (event.event === 'complete') {
          complete = true;
        } else {
          yield* file.writeAll(encoder.encode(`${JSON.stringify(event.data)}\n`));
          hasLogs = true;
        }
      }
      if (!complete) {
        return yield* new ExportLogsIncomplete();
      }
      return hasLogs;
    }),
  ).pipe(
    Effect.tap((hasLogs) =>
      hasLogs ? Effect.void : Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(destination)),
    ),
  );
}

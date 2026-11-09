import type { FileSystem, Path } from '@effect/platform';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect, Option, SynchronizedRef } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import { type NibrunnerLogCursor, NibrunnerLogCursorSchema } from '#lib/nibrunner/log-reader.ts';

const PositionsSchema = Type.Record(AppIdSchema, NibrunnerLogCursorSchema, {
  additionalProperties: false,
});

export type NibrunnerLogPosition = NibrunnerLogCursor & { appId: AppId };

export class NibrunnerLogCursorsUnavailable extends Data.TaggedError(
  'NibrunnerLogCursorsUnavailable',
) {
  override get message() {
    return 'The nibrunner log delivery positions are unavailable.';
  }
}

function readPositions(value: unknown) {
  return Effect.try({
    try: () => {
      if (!Value.Check(PositionsSchema, value)) {
        throw new NibrunnerLogCursorsUnavailable();
      }
      return new Map<string, NibrunnerLogCursor>(Object.entries(value));
    },
    catch: () => new NibrunnerLogCursorsUnavailable(),
  });
}

export function makeNibrunnerLogCursors({ file }: { file: string }) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const stored = Option.getOrElse(yield* readJsonFile(file), () => ({}));
    const positions = yield* SynchronizedRef.make(yield* readPositions(stored));

    function commit(batch: readonly NibrunnerLogPosition[]) {
      return SynchronizedRef.updateEffect(positions, (current) =>
        Effect.gen(function* () {
          const next = new Map(current);
          for (const { appId, fileId, offset } of batch) {
            next.set(appId, { fileId, offset });
          }
          const checked = yield* readPositions(Object.fromEntries(next));
          yield* writeJsonFile({ path: file, value: Object.fromEntries(checked) });
          return checked;
        }),
      ).pipe(
        Effect.provide(context),
        Effect.uninterruptible,
        Effect.mapError(() => new NibrunnerLogCursorsUnavailable()),
      );
    }

    return {
      get: (appId: AppId) =>
        SynchronizedRef.get(positions).pipe(Effect.map((held) => held.get(appId))),
      commit,
    };
  }).pipe(Effect.mapError(() => new NibrunnerLogCursorsUnavailable()));
}

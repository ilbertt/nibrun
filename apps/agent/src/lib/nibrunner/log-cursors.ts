import { Database } from 'bun:sqlite';
import { FileSystem, Path } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Data, Effect } from 'effect';
import type { NibrunnerLogCursor } from '#lib/nibrunner/log-reader.ts';

export type NibrunnerLogPosition = NibrunnerLogCursor & { appId: AppId };

export class NibrunnerLogCursorsUnavailable extends Data.TaggedError(
  'NibrunnerLogCursorsUnavailable',
) {
  override get message() {
    return 'The nibrunner log delivery positions could not be stored.';
  }
}

export function makeNibrunnerLogCursors({ file }: { file: string }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
    const database = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new Database(file, { create: true, strict: true }),
        catch: () => new NibrunnerLogCursorsUnavailable(),
      }),
      (database) => Effect.sync(() => database.close()),
    );
    return yield* Effect.try({
      try: () => {
        database.exec(`
          PRAGMA journal_mode = WAL;
          PRAGMA synchronous = FULL;
          CREATE TABLE IF NOT EXISTS log_cursors (
            app_id TEXT PRIMARY KEY NOT NULL,
            file_id TEXT NOT NULL,
            offset INTEGER NOT NULL CHECK (offset >= 0)
          ) STRICT;
        `);
        const select = database.query<NibrunnerLogCursor, [AppId]>(
          'SELECT file_id AS fileId, offset FROM log_cursors WHERE app_id = ?',
        );
        const insert = database.query(`
          INSERT INTO log_cursors (app_id, file_id, offset) VALUES (?, ?, ?)
          ON CONFLICT (app_id) DO UPDATE SET file_id = excluded.file_id, offset = excluded.offset
        `);
        const save = database.transaction(function savePositions(
          positions: readonly NibrunnerLogPosition[],
        ) {
          for (const position of positions) {
            insert.run(position.appId, position.fileId, position.offset);
          }
        });
        return {
          get: (appId: AppId) =>
            Effect.try({
              try: () => select.get(appId) ?? undefined,
              catch: () => new NibrunnerLogCursorsUnavailable(),
            }),
          commit: (positions: readonly NibrunnerLogPosition[]) =>
            Effect.try({
              try: () => save(positions),
              catch: () => new NibrunnerLogCursorsUnavailable(),
            }),
        };
      },
      catch: () => new NibrunnerLogCursorsUnavailable(),
    });
  }).pipe(Effect.mapError(() => new NibrunnerLogCursorsUnavailable()));
}

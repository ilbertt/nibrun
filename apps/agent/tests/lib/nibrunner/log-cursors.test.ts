import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { makeNibrunnerLogCursors } from '#lib/nibrunner/log-cursors.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const SECOND_APP_ID = Value.Parse(AppIdSchema, 'second-app');

function position(appId: AppId) {
  return { appId, fileId: 'file-1', offset: 123 };
}

test('acknowledged positions survive closing and reopening the store', async () => {
  await run(
    Effect.gen(function* () {
      const file = `${yield* temporaryDirectory}/bridge/logs.json`;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const cursors = yield* makeNibrunnerLogCursors({ file });
          expect(yield* cursors.get(APP_ID)).toBeUndefined();
          yield* cursors.commit([position(APP_ID)]);
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const cursors = yield* makeNibrunnerLogCursors({ file });
          expect(yield* cursors.get(APP_ID)).toEqual({ fileId: 'file-1', offset: 123 });
          yield* cursors.commit([{ ...position(APP_ID), fileId: 'rotated-file', offset: 456 }]);
          expect(yield* cursors.get(APP_ID)).toEqual({ fileId: 'rotated-file', offset: 456 });
        }),
      );
    }),
  );
});

test('a failed checkpoint leaves every app at its previous position', async () => {
  await run(
    Effect.gen(function* () {
      const file = `${yield* temporaryDirectory}/logs.json`;
      const cursors = yield* makeNibrunnerLogCursors({ file });
      yield* cursors.commit([position(APP_ID)]);
      const error = yield* Effect.flip(
        cursors.commit([
          { ...position(APP_ID), offset: 456 },
          { ...position(SECOND_APP_ID), offset: -1 },
        ]),
      );
      expect(error._tag).toBe('NibrunnerLogCursorsUnavailable');
      expect(yield* cursors.get(APP_ID)).toEqual({ fileId: 'file-1', offset: 123 });
      expect(yield* cursors.get(SECOND_APP_ID)).toBeUndefined();
    }),
  );
});

test('a failed rename preserves both the saved positions and the in-memory positions', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const file = `${yield* temporaryDirectory}/logs.json`;
      const original = yield* makeNibrunnerLogCursors({ file });
      yield* original.commit([position(APP_ID)]);
      const before = yield* fs.readFileString(file);
      const failing = yield* makeNibrunnerLogCursors({ file }).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          rename: () =>
            Effect.fail(
              new SystemError({
                reason: 'PermissionDenied',
                module: 'FileSystem',
                method: 'rename',
              }),
            ),
        }),
      );
      expect(
        (yield* Effect.flip(failing.commit([{ ...position(APP_ID), offset: 456 }])))._tag,
      ).toBe('NibrunnerLogCursorsUnavailable');
      expect(yield* failing.get(APP_ID)).toEqual({ fileId: 'file-1', offset: 123 });
      expect(yield* fs.readFileString(file)).toBe(before);
    }),
  );
});

test('concurrent commits preserve positions for every app', async () => {
  await run(
    Effect.gen(function* () {
      const file = `${yield* temporaryDirectory}/logs.json`;
      const cursors = yield* makeNibrunnerLogCursors({ file });
      yield* Effect.all(
        [cursors.commit([position(APP_ID)]), cursors.commit([position(SECOND_APP_ID)])],
        { concurrency: 'unbounded' },
      );
      const restored = yield* makeNibrunnerLogCursors({ file });
      expect(yield* restored.get(APP_ID)).toEqual({ fileId: 'file-1', offset: 123 });
      expect(yield* restored.get(SECOND_APP_ID)).toEqual({ fileId: 'file-1', offset: 123 });
    }),
  );
});

test.each(['not-json', JSON.stringify({ [APP_ID]: { fileId: 'file-1', offset: -1 } })])(
  'invalid stored positions fail without overwriting the file: %s',
  async (content) => {
    await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = `${yield* temporaryDirectory}/logs.json`;
        yield* fs.writeFileString(file, content);
        expect((yield* Effect.flip(makeNibrunnerLogCursors({ file })))._tag).toBe(
          'NibrunnerLogCursorsUnavailable',
        );
        expect(yield* fs.readFileString(file)).toBe(content);
      }),
    );
  },
);

import { expect, test } from 'bun:test';
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
      const file = `${yield* temporaryDirectory}/bridge/logs.sqlite`;
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
      const file = `${yield* temporaryDirectory}/logs.sqlite`;
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

import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { MAX_NIBRUNNER_LOG_READ_BYTES, readNibrunnerLogChunk } from '#lib/nibrunner/log-reader.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const files = Effect.gen(function* () {
  const directory = yield* temporaryDirectory;
  const fs = yield* FileSystem.FileSystem;
  return {
    fs,
    directory,
    current: `${directory}/${APP_ID}.jsonl`,
    previous: `${directory}/${APP_ID}.jsonl.1`,
  };
});

test('missing files and unfinished records do not advance a cursor', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, current } = yield* files;
      const input = { directory, appId: APP_ID, cursor: undefined };
      expect(yield* readNibrunnerLogChunk(input)).toBeUndefined();
      yield* fs.writeFileString(current, '{"text":"unfinished');
      expect(yield* readNibrunnerLogChunk(input)).toBeUndefined();
      yield* fs.writeFileString(current, '"}\n', { flag: 'a' });
      expect((yield* readNibrunnerLogChunk(input))?.lines).toEqual(['{"text":"unfinished"}']);
    }),
  );
});

test('byte offsets preserve unicode and resume after complete records', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, current } = yield* files;
      const first = '{"text":"猫"}\n';
      yield* fs.writeFileString(current, `${first}{"text":"é`);
      const chunk = yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: undefined });
      expect(chunk?.cursor.offset).toBe(Buffer.byteLength(first));
      yield* fs.writeFileString(current, '"}\n', { flag: 'a' });
      const next = yield* readNibrunnerLogChunk({
        directory,
        appId: APP_ID,
        cursor: chunk?.cursor,
      });
      expect(next?.lines).toEqual(['{"text":"é"}']);
      expect(
        yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: next?.cursor }),
      ).toBeUndefined();
    }),
  );
});

test('rotation drains the previous inode before reading the new file', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, current, previous } = yield* files;
      yield* fs.writeFileString(current, 'first\n');
      const first = yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: undefined });
      yield* fs.writeFileString(current, 'second\n', { flag: 'a' });
      yield* fs.rename(current, previous);
      yield* fs.writeFileString(current, 'third\n');
      const second = yield* readNibrunnerLogChunk({
        directory,
        appId: APP_ID,
        cursor: first?.cursor,
      });
      const third = yield* readNibrunnerLogChunk({
        directory,
        appId: APP_ID,
        cursor: second?.cursor,
      });
      expect(second?.lines).toEqual(['second']);
      expect(third?.lines).toEqual(['third']);
      expect(second?.cursor.fileId).toBe(first?.cursor.fileId);
      expect(third?.cursor.fileId).not.toBe(first?.cursor.fileId);
    }),
  );
});

test('a lost rotation resumes from the oldest retained file', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, current, previous } = yield* files;
      yield* fs.writeFileString(previous, 'retained\n');
      yield* fs.writeFileString(current, 'newest\n');
      const chunk = yield* readNibrunnerLogChunk({
        directory,
        appId: APP_ID,
        cursor: { fileId: 'gone', offset: 500 },
      });
      expect(chunk?.lines).toEqual(['retained']);
    }),
  );
});

test('an immutable rotated tail can finish without a final newline', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, previous } = yield* files;
      yield* fs.writeFileString(previous, 'retained');
      expect(
        (yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: undefined }))?.lines,
      ).toEqual(['retained']);
    }),
  );
});

test('a truncated file restarts at zero and an oversized record is refused', async () => {
  await run(
    Effect.gen(function* () {
      const { fs, directory, current } = yield* files;
      yield* fs.writeFileString(current, 'a longer record\n');
      const first = yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: undefined });
      yield* fs.writeFileString(current, 'new\n');
      expect(
        (yield* readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: first?.cursor }))?.lines,
      ).toEqual(['new']);
      yield* fs.writeFileString(current, 'x'.repeat(MAX_NIBRUNNER_LOG_READ_BYTES + 1));
      const error = yield* Effect.flip(
        readNibrunnerLogChunk({ directory, appId: APP_ID, cursor: undefined }),
      );
      expect(error._tag).toBe('NibrunnerLogReadFailed');
    }),
  );
});

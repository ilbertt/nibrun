import { FileSystem, Path } from '@effect/platform';
import type { AppId } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';

export const MAX_NIBRUNNER_LOG_READ_BYTES = 1_048_576;

export type NibrunnerLogCursor = { fileId: string; offset: number };
export type NibrunnerLogChunk = {
  cursor: NibrunnerLogCursor;
  lines: readonly string[];
  bytes: number;
};
type LogFile = {
  file: FileSystem.File;
  fileId: string;
  size: number;
  kind: 'current' | 'rotated';
};

export class NibrunnerLogReadFailed extends Data.TaggedError('NibrunnerLogReadFailed') {
  override get message() {
    return 'The nibrunner tenant log file could not be read.';
  }
}

function openLogFile({ path, kind }: { path: string; kind: LogFile['kind'] }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = yield* fs.open(path, { flag: 'r' });
    const info = yield* file.stat;
    if (info.type !== 'File' || Option.isNone(info.ino)) {
      return yield* new NibrunnerLogReadFailed();
    }
    const created = Option.getOrUndefined(info.birthtime)?.getTime() ?? 0;
    return {
      file,
      kind,
      fileId: `${info.dev}:${info.ino.value}:${created}`,
      size: Number(info.size),
    } satisfies LogFile;
  }).pipe(
    Effect.catchAll((error) =>
      error._tag === 'SystemError' && error.reason === 'NotFound'
        ? Effect.succeed(undefined)
        : Effect.fail(new NibrunnerLogReadFailed()),
    ),
  );
}

function offsetFor({ file, cursor }: { file: LogFile; cursor: NibrunnerLogCursor | undefined }) {
  return cursor?.fileId === file.fileId && cursor.offset <= file.size ? cursor.offset : 0;
}

function readWindow(file: FileSystem.File) {
  return Effect.gen(function* () {
    const buffer = new Uint8Array(MAX_NIBRUNNER_LOG_READ_BYTES);
    let size = 0;
    while (size < buffer.length) {
      const read = Number(yield* file.read(buffer.subarray(size)));
      if (read === 0) {
        break;
      }
      size += read;
    }
    return buffer.subarray(0, size);
  });
}

function readChunk({ file, offset }: { file: LogFile; offset: number }) {
  return Effect.gen(function* () {
    yield* file.file.seek(offset, 'start');
    const bytes = yield* readWindow(file.file);
    const size = bytes.length;
    if (size === 0) {
      return undefined;
    }
    const complete =
      file.kind === 'rotated' && offset + size === file.size ? size : bytes.lastIndexOf(10) + 1;
    if (complete === 0) {
      return size === MAX_NIBRUNNER_LOG_READ_BYTES
        ? yield* new NibrunnerLogReadFailed()
        : undefined;
    }
    const lines = yield* Effect.try({
      try: () => new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, complete)),
      catch: () => new NibrunnerLogReadFailed(),
    });
    const records = lines.split('\n');
    if (records.at(-1) === '') {
      records.pop();
    }
    return {
      cursor: { fileId: file.fileId, offset: offset + complete },
      lines: records,
      bytes: complete,
    } satisfies NibrunnerLogChunk;
  });
}

export function readNibrunnerLogChunk({
  directory,
  appId,
  cursor,
}: {
  directory: string;
  appId: AppId;
  cursor: NibrunnerLogCursor | undefined;
}) {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const opened = yield* Effect.all([
      openLogFile({ path: path.join(directory, `${appId}.jsonl.1`), kind: 'rotated' }),
      openLogFile({ path: path.join(directory, `${appId}.jsonl`), kind: 'current' }),
    ]);
    const files = opened.filter((file) => file !== undefined);
    const start = Math.max(
      0,
      files.findIndex((file) => file.fileId === cursor?.fileId),
    );
    for (const file of files.slice(start)) {
      const offset = offsetFor({ file, cursor });
      const chunk = yield* readChunk({ file, offset });
      if (chunk !== undefined || offset < file.size) {
        return chunk;
      }
    }
    return undefined;
  }).pipe(
    Effect.scoped,
    Effect.mapError(() => new NibrunnerLogReadFailed()),
  );
}

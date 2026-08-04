import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Option } from 'effect';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const JSON_INDENT = 2;

export class MalformedJsonError extends Data.TaggedError('MalformedJsonError')<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export const readJsonFile = (path: string) =>
  Effect.gen(function* () {
    const text = yield* readTextFile(path);
    return yield* Option.match(text, {
      onNone: () => Effect.succeedNone,
      onSome: (value) =>
        Effect.try({
          try: () => Option.some(JSON.parse(value) as unknown),
          catch: (cause) => new MalformedJsonError({ path, cause }),
        }),
    });
  });

export const readTextFile = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(path))) {
      return Option.none<string>();
    }
    return Option.some((yield* fs.readFileString(path)).trim());
  });

export const writeJsonFile = ({ path, value }: { path: string; value: unknown }) =>
  writeTextFile({ path, value: `${JSON.stringify(value, null, JSON_INDENT)}\n` });

/**
 * Through a uniquely named sibling and a rename, which is atomic within a directory on ext4: a
 * torn write cannot leave an unparsable state file, and two writes in flight cannot collide.
 */
export const writeTextFile = ({
  path,
  value,
  mode = PRIVATE_FILE_MODE,
}: {
  path: string;
  value: string;
  mode?: number;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fs.makeDirectory(pathService.dirname(path), {
      recursive: true,
      mode: PRIVATE_DIR_MODE,
    });
    const temporary = yield* Effect.sync(() => `${path}.${crypto.randomUUID()}.tmp`);
    yield* fs.writeFileString(temporary, value, { mode });
    yield* fs.rename(temporary, path);
  });

import { HostVersionsSchema, parseMessage } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { readJsonFile } from '#lib/json-store.ts';
import { decode } from '#lib/protocol.ts';

export class MissingVersionsError extends Data.TaggedError('MissingVersionsError')<{
  readonly path: string;
}> {}

/**
 * The pins CI writes into the bundle, read rather than compiled in, so a report cannot claim a
 * version the active symlink no longer points at.
 */
export const readHostVersions = (path: string) =>
  Effect.gen(function* () {
    const value = yield* readJsonFile(path);
    if (Option.isNone(value)) {
      return yield* new MissingVersionsError({ path });
    }
    return yield* decode(() => parseMessage({ schema: HostVersionsSchema, value: value.value }));
  });

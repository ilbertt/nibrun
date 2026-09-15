import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Effect, Either } from 'effect';
import { NBD_DIRECTORY, removeDeviceFile } from '#lib/volumes/device-file.ts';
import { VOLUME_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

describe('a device file is only ever removed from a mounted filesystem', () => {
  /**
   * A temporary directory is on the same device as its parent, which is what an unmounted
   * ZeroFS looks like: a directory on the host's own disk, holding nothing of any volume. Reading
   * the file's absence there as the volume being gone is the mistake this refuses.
   */
  test('a mount that is not one is refused, and the file left where it is', async () => {
    const { refused, kept } = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const mount = yield* temporaryDirectory;
        const device = `${mount}/${NBD_DIRECTORY}/${VOLUME_ID}`;
        yield* fs.makeDirectory(`${mount}/${NBD_DIRECTORY}`);
        yield* fs.writeFileString(device, 'tenant bytes');

        const refused = yield* Effect.either(removeDeviceFile({ mount, volumeId: VOLUME_ID }));
        const kept = yield* fs.exists(device);
        return { refused, kept };
      }),
    );

    expect(Either.isLeft(refused) && refused.left._tag).toBe('NotMounted');
    expect(kept).toBe(true);
  });
});

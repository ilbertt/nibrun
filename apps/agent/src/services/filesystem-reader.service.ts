import type { AppId, DirectoryListing, GuestPath } from '@repo/protocol';
import { Data, Duration, Effect, Either, Option } from 'effect';
import {
  LISTING_ENVIRONMENT,
  listingCommand,
  parseListing,
  UnreadableDirectory,
} from '#lib/filesystem/debugfs.ts';
import { stdoutOf } from '#services/command-runner.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

/**
 * Bounded well below the export path's hour: a listing is read while somebody waits for it, and
 * a directory large enough to take longer than this is one the entry limit would truncate anyway.
 */
const LISTING_TIMEOUT_SECONDS = 20;
const LISTING_TIMEOUT = Duration.seconds(LISTING_TIMEOUT_SECONDS);

export class NoDeviceForApp extends Data.TaggedError('NoDeviceForApp')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `no device is attached on this host for ${this.appId}`;
  }
}

/**
 * Reads one directory out of one tenant's filesystem.
 *
 * The slot lookup is what scopes it: an app resolves to the single device this host attached for
 * it, so a path is only ever resolved against the filesystem its own app owns. Nothing here takes
 * a device path from a caller.
 */
export class FilesystemReader extends Effect.Service<FilesystemReader>()('FilesystemReader', {
  effect: Effect.gen(function* () {
    const allocator = yield* SlotAllocator;

    const list = Effect.fn('FilesystemReader.list')(function* ({
      appId,
      path,
    }: {
      appId: AppId;
      path: GuestPath;
    }) {
      yield* Effect.annotateCurrentSpan({ appId, path });
      const slot = yield* allocator.lookup(appId);
      if (Option.isNone(slot)) {
        return yield* new NoDeviceForApp({ appId });
      }

      const { nbdDevicePath } = slot.value;
      const command = yield* listingCommand({ devicePath: nbdDevicePath, path });
      const output = yield* stdoutOf({
        command,
        timeout: LISTING_TIMEOUT,
        env: LISTING_ENVIRONMENT,
      });

      const listing = parseListing({ output, path });
      return Either.isLeft(listing)
        ? yield* new UnreadableDirectory({ devicePath: nbdDevicePath })
        : (listing.right satisfies DirectoryListing);
    });

    return { list };
  }),
  dependencies: [SlotAllocator.Default],
}) {}

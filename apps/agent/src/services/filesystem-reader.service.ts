import type { AppId, DirectoryListing, GuestPath } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { guestFilesystem } from '#lib/filesystem/client.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export class NoDeviceForApp extends Data.TaggedError('NoDeviceForApp')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `no device is attached on this host for ${this.appId}`;
  }
}

/**
 * Reads one directory out of one tenant's filesystem, by asking the guest that has it mounted.
 *
 * The slot lookup is what scopes it: an app resolves to the single microVM this host runs for it,
 * so a path is only ever resolved inside the filesystem its own app owns — and inside the guest,
 * which is the only place that can answer without the volume's flush interval standing between
 * the tenant's last write and what somebody sees.
 *
 * Reading is all this offers. The write verbs are on the client, waiting for the control plane to
 * carry a request for one.
 */
export class FilesystemReader extends Effect.Service<FilesystemReader>()('FilesystemReader', {
  effect: Effect.gen(function* () {
    const allocator = yield* SlotAllocator;
    const config = yield* AgentConfig;

    const list = Effect.fn('FilesystemReader.list')(function* ({
      appId,
      path,
    }: {
      appId: AppId;
      path: GuestPath;
    }) {
      yield* Effect.annotateCurrentSpan({ appId, path });
      if (Option.isNone(yield* allocator.lookup(appId))) {
        return yield* new NoDeviceForApp({ appId });
      }
      const listing = yield* Effect.scoped(
        Effect.flatMap(guestFilesystem({ appId, vmDir: config.vmDir }), (guest) =>
          guest.list(path),
        ),
      );
      return listing satisfies DirectoryListing;
    });

    return { list };
  }),
  dependencies: [SlotAllocator.Default, AgentConfig.Default],
}) {}

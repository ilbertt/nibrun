import type { AppId, DirectoryListing, FilesystemUsage, GuestPath } from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import {
  type GuestFilesystem,
  type GuestFilesystemError,
  guestFilesystem,
} from '#lib/filesystem/client.ts';
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
 * Reads one tenant's filesystem, by asking the guest that has it mounted.
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

    const asked = <A>({
      appId,
      of,
    }: {
      appId: AppId;
      of: (guest: GuestFilesystem) => Effect.Effect<A, GuestFilesystemError>;
    }) =>
      Effect.gen(function* () {
        if (Option.isNone(yield* allocator.lookup(appId))) {
          return yield* new NoDeviceForApp({ appId });
        }
        return yield* Effect.scoped(
          Effect.flatMap(guestFilesystem({ appId, vmDir: config.vmDir }), of),
        );
      });

    const list = Effect.fn('FilesystemReader.list')(function* ({
      appId,
      path,
    }: {
      appId: AppId;
      path: GuestPath;
    }) {
      yield* Effect.annotateCurrentSpan({ appId, path });
      const listing = yield* asked({ appId, of: (guest) => guest.list(path) });
      return listing satisfies DirectoryListing;
    });

    /**
     * Stamped on this side because the guest has no clock worth reading: it boots without one and
     * nothing tells it the time. What the moment is for is telling a reading taken a minute ago
     * from one taken before the app was suspended last month.
     */
    const usage = Effect.fn('FilesystemReader.usage')(function* ({ appId }: { appId: AppId }) {
      yield* Effect.annotateCurrentSpan({ appId });
      const measured = yield* asked({ appId, of: (guest) => guest.usage() });
      return { ...measured, measuredAt: yield* nowTimestamp } satisfies FilesystemUsage;
    });

    return { list, usage };
  }),
  dependencies: [SlotAllocator.Default, AgentConfig.Default],
}) {}

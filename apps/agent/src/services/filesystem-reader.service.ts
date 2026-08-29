import type {
  AppId,
  DirectoryListing,
  FilesystemUsage,
  GuestPath,
  Timestamp,
} from '@repo/protocol';
import { Data, Effect, Option } from 'effect';
import { nowTimestamp } from '#lib/clock.ts';
import {
  type GuestFilesystem,
  type GuestFilesystemError,
  guestFilesystem,
} from '#lib/filesystem/client.ts';
import type { MeasuredCompute } from '#lib/filesystem/protocol.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

export class NoDeviceForApp extends Data.TaggedError('NoDeviceForApp')<{
  readonly appId: AppId;
}> {
  override get message() {
    return `no device is attached on this host for ${this.appId}`;
  }
}

/** The counters as they were read, with the moment this side read them. */
export type MeasuredComputeAt = MeasuredCompute & { readonly measuredAt: Timestamp };

/**
 * Everything one guest can be asked about itself, taken together.
 *
 * Either half can be missing while the other arrived: they are two exchanges, and a guest whose
 * image predates one of the verbs refuses that one and answers the other — which is what every
 * host looks like between this shipping and the image release behind it.
 */
export type GuestReading = {
  readonly filesystem: FilesystemUsage | undefined;
  readonly compute: MeasuredComputeAt | undefined;
};

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

    function asked<A>({
      appId,
      of,
    }: {
      appId: AppId;
      of: (guest: GuestFilesystem) => Effect.Effect<A, GuestFilesystemError>;
    }) {
      return Effect.gen(function* () {
        if (Option.isNone(yield* allocator.lookup(appId))) {
          return yield* new NoDeviceForApp({ appId });
        }
        return yield* Effect.scoped(
          Effect.flatMap(guestFilesystem({ appId, vmDir: config.vmDir }), of),
        );
      });
    }

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
     * A verb the guest would not do is not the connection failing, so it costs its own half of
     * the reading and nothing else. A guest that stopped answering altogether is left to fail the
     * whole thing instead: asking the second verb over a socket the first one timed out on would
     * spend another reply timeout learning what is already known.
     */
    function separately<A>(reading: Effect.Effect<A, GuestFilesystemError>) {
      return reading.pipe(
        Effect.catchTags({
          GuestFilesystemRefused: (refused) => unanswered(refused),
          MalformedGuestReply: (malformed) => unanswered(malformed),
        }),
      );
    }

    /**
     * Both halves over one connection, because a connection is a process the guest forks and the
     * tenant's own memory is one of the things being measured here.
     *
     * Stamped on this side because the guest has no clock worth reading: it boots without one and
     * nothing tells it the time. What the moment is for is telling a reading taken a minute ago
     * from one taken before the app was suspended last month.
     *
     * Read before the guest is asked rather than after it answers, so the moment is one the
     * reading cannot be older than. A guest taking the whole reply timeout would otherwise have
     * its reading stamped with the instant it arrived, and the age of a reading is the one thing
     * that must never be overstated.
     */
    const measure = Effect.fn('FilesystemReader.measure')(function* ({ appId }: { appId: AppId }) {
      yield* Effect.annotateCurrentSpan({ appId });
      const measuredAt = yield* nowTimestamp;
      const taken = yield* asked({
        appId,
        of: (guest) =>
          Effect.all({
            filesystem: separately(guest.usage()),
            compute: separately(guest.compute()),
          }),
      });
      return {
        filesystem: taken.filesystem && { ...taken.filesystem, measuredAt },
        compute: taken.compute && { ...taken.compute, measuredAt },
      } satisfies GuestReading;
    });

    return { list, measure };
  }),
  dependencies: [SlotAllocator.Default, AgentConfig.Default],
}) {}

function unanswered(error: GuestFilesystemError) {
  return Effect.as(
    Effect.logDebug('the guest would not answer part of a reading', error),
    undefined,
  );
}

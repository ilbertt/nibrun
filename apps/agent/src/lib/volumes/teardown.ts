import type { DesiredVolume, ReportedVolume } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { removeDeviceFile } from '#lib/volumes/device-file.ts';
import { detach } from '#lib/volumes/nbd.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';

const EMPTY_SIZE = 0;

/** Only for explicit deletion, with guest writes stopped and the assigned device on this filesystem. */
export function teardownVolume({
  desired,
  filesystem,
}: {
  desired: DesiredVolume;
  filesystem: ZerofsLiveFilesystem;
}) {
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ volumeId: desired.volumeId, appId: desired.appId });
    const allocator = yield* SlotAllocator;
    const slot = yield* allocator.lookup(desired.appId);
    // With ignore_fsync, detaching before this barrier can lose acknowledged guest writes.
    yield* flush(filesystem.admin);
    if (Option.isSome(slot)) {
      yield* detach(slot.value.nbdDevicePath);
    }
    yield* removeDeviceFile({ mount: filesystem.mountPath, volumeId: desired.volumeId });
    yield* allocator.release(desired.appId);
    // The control plane finishes deleting the app on the strength of this report.
    return {
      volumeId: desired.volumeId,
      appId: desired.appId,
      state: 'deleted',
      sizeBytes: EMPTY_SIZE,
    } satisfies ReportedVolume;
  });
}

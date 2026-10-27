import { Data, Effect } from 'effect';
import { assertMounted } from '#lib/volumes/device-file.ts';
import { detachAndWaitForDisconnect } from '#lib/volumes/nbd.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import { flush } from '#lib/volumes/zerofs.ts';

export type VolumeMigrationDetachInput = {
  source: ZerofsLiveFilesystem;
  devicePath: string;
};

export class VolumeMigrationSourceDetachFailed extends Data.TaggedError(
  'VolumeMigrationSourceDetachFailed',
) {
  override get message() {
    return 'The volume migration source could not be detached safely.';
  }
}

/** Requires a stopped VM and exclusive lifecycle ownership of the source and assigned device. */
export function detachVolumeMigrationSource({ source, devicePath }: VolumeMigrationDetachInput) {
  return Effect.gen(function* () {
    yield* assertMounted(source.mountPath);
    yield* flush(source.admin);
    yield* detachAndWaitForDisconnect(devicePath);
    // Carry any final writes through the backend after the kernel client has gone.
    yield* flush(source.admin);
  }).pipe(Effect.mapError(() => new VolumeMigrationSourceDetachFailed()));
}

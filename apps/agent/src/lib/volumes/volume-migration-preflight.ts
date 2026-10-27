import { Sha256DigestSchema, VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect, Option } from 'effect';
import {
  type AppVolumeFile,
  appVolumeFileSize,
  openAppVolumeImage,
  removeAppVolumeFile,
} from '#lib/volumes/app-volume-file.ts';
import type { ZerofsLiveFilesystem } from '#lib/volumes/topology.ts';
import {
  inspectVolumeImage,
  type VolumeImageCopyInput,
  verifyImageBytes,
} from '#lib/volumes/volume-image-copy.ts';
import { flush } from '#lib/volumes/zerofs.ts';

const PROBE_SIZE_BYTES = 512;

export class VolumeMigrationPreflightFailed extends Data.TaggedError(
  'VolumeMigrationPreflightFailed',
) {
  override get message() {
    return 'The volume storage migration readiness check failed.';
  }
}

function native<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: () => new VolumeMigrationPreflightFailed(),
  }).pipe(Effect.uninterruptible);
}

function requireMissingImage(input: AppVolumeFile) {
  return Effect.gen(function* () {
    if (Option.isSome(yield* appVolumeFileSize(input))) {
      return yield* new VolumeMigrationPreflightFailed();
    }
  });
}

function probeDestination(destination: ZerofsLiveFilesystem) {
  return Effect.scoped(
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const probe = {
          mountPath: destination.mountPath,
          volumeId: Value.Parse(VolumeIdSchema, `preflight-${crypto.randomUUID()}`),
        };
        const image = yield* openAppVolumeImage({ ...probe, access: 'create' });
        const outcome = yield* Effect.exit(
          restore(
            Effect.scoped(
              Effect.gen(function* () {
                const bytes = crypto.getRandomValues(new Uint8Array(PROBE_SIZE_BYTES));
                const digest = Value.Parse(
                  Sha256DigestSchema,
                  new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
                );
                yield* native(() => image.writeFile(bytes));
                yield* native(() => image.sync());
                yield* flush(destination.admin);
                const reopened = yield* openAppVolumeImage({ ...probe, access: 'read' });
                yield* verifyImageBytes({ image: reopened, sizeBytes: bytes.length, digest });
              }),
            ),
          ),
        );
        const closed = yield* Effect.exit(native(() => image.close()));
        yield* removeAppVolumeFile(probe);
        yield* flush(destination.admin);
        yield* closed;
        yield* outcome;
      }),
    ),
  );
}

/** Requires mounted filesystems and exclusive destination ownership; does not quiesce the source. */
export function preflightVolumeImageCopy(input: VolumeImageCopyInput) {
  return Effect.scoped(
    Effect.gen(function* () {
      const source = yield* openAppVolumeImage({
        mountPath: input.source.mountPath,
        volumeId: input.volumeId,
        access: 'read',
      });
      yield* inspectVolumeImage({ image: source, sizeBytes: input.sizeBytes });
      const target = { mountPath: input.destination.mountPath, volumeId: input.volumeId };
      yield* requireMissingImage(target);
      yield* probeDestination(input.destination);
      yield* requireMissingImage(target);
    }),
  ).pipe(Effect.mapError(() => new VolumeMigrationPreflightFailed()));
}

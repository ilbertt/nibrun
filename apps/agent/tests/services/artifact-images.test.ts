import { describe, expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Deferred, Duration, Effect, Either, Fiber, Layer, Ref, Schedule } from 'effect';
import { ArtifactImages } from '#services/artifact-images.service.ts';
import { ArtifactStore, ArtifactTransferError } from '#services/artifact-store.service.ts';
import type { CommandRunner } from '#services/command-runner.service.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST, artifactStore } from '#tests/support/artifacts.ts';
import { recordingCommands } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

/**
 * mksquashfs as it behaves when it fails: the output file exists by the time it gives up, which
 * is what used to be left in the cache. `command[2]` is the destination it was asked to write.
 */
const DESTINATION_ARGUMENT = 2;

const MKFS_FAILED = 1;
const MKFS_OK = 0;

const ONE_BUILD = 1;
const NOT_STARTED = 0;
const FIRST_ATTEMPT = 1;
const POLL_INTERVAL = Duration.millis(1);

function mksquashfsThat({ code }: { code: number }) {
  return recordingCommands((request) =>
    Effect.promise(async () => {
      await Bun.write(request.command[DESTINATION_ARGUMENT] ?? '', 'a squashfs image');
      return { code, stdout: '', stderr: '' };
    }),
  );
}

function artifactBytes() {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(ARTIFACT_BYTES);
      controller.close();
    },
  });
}

/** The bucket as a build in flight: it counts its callers and hands out nothing until released. */
function heldStore({
  opens,
  released,
}: {
  opens: Ref.Ref<number>;
  released: Deferred.Deferred<void>;
}) {
  return Layer.succeed(
    ArtifactStore,
    ArtifactStore.make({
      open: () =>
        Ref.update(opens, (started) => started + 1).pipe(
          Effect.andThen(Deferred.await(released)),
          Effect.map(artifactBytes),
        ),
    }),
  );
}

/** A bucket that is unreachable exactly once, so what a failed build left behind is visible. */
function unreachableOnceStore(opens: Ref.Ref<number>) {
  return Layer.succeed(
    ArtifactStore,
    ArtifactStore.make({
      open: () =>
        Ref.updateAndGet(opens, (started) => started + 1).pipe(
          Effect.flatMap((attempt) =>
            attempt === FIRST_ATTEMPT
              ? Effect.fail(new ArtifactTransferError({ cause: 'the bucket was unreachable' }))
              : Effect.sync(artifactBytes),
          ),
        ),
    }),
  );
}

function imagesOver(host: Layer.Layer<ArtifactStore | CommandRunner>) {
  return Effect.gen(function* () {
    const cacheDir = yield* temporaryDirectory;
    return {
      cacheDir,
      layer: ArtifactImages.DefaultWithoutDependencies.pipe(
        Layer.provide(Layer.merge(agentConfig({ artifactCacheDir: cacheDir }), host)),
      ),
    };
  });
}

const ensuring = Effect.flatMap(ArtifactImages, (images) => images.ensure(artifact()));

function buildingInto({ code }: { code: number }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const commands = mksquashfsThat({ code });
    const { cacheDir, layer } = yield* imagesOver(Layer.merge(artifactStore(), commands.layer));
    const result = yield* Effect.either(Effect.provide(ensuring, layer));
    return { result, entries: yield* fs.readDirectory(cacheDir) };
  });
}

describe('a build leaves the cache holding finished images and nothing else', () => {
  // Every way a build can end between mksquashfs and the rename used to leave the image behind,
  // and only a later build of the same digest ever cleared it.
  test('one that fails after writing its image leaves nothing at all', async () => {
    const { result, entries } = await run(buildingInto({ code: MKFS_FAILED }));

    expect(Either.isLeft(result)).toBe(true);
    expect(entries).toEqual([]);
  });

  test('one that succeeds leaves the image under its digest and no staging beside it', async () => {
    const { result, entries } = await run(buildingInto({ code: MKFS_OK }));

    expect(Either.isRight(result)).toBe(true);
    expect(entries).toEqual([ARTIFACT_DIGEST]);
  });
});

/** Racing here means one caller's acquire removing the directory the other is downloading into. */
const racingBuilds = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const opens = yield* Ref.make(NOT_STARTED);
  const released = yield* Deferred.make<void>();
  const commands = mksquashfsThat({ code: MKFS_OK });
  const { cacheDir, layer } = yield* imagesOver(
    Layer.merge(heldStore({ opens, released }), commands.layer),
  );

  const paths = yield* Effect.provide(
    Effect.gen(function* () {
      const first = yield* Effect.fork(ensuring);
      // The second caller arrives only once the first is downloading, which is the window the
      // shared `.staging-<digest>` name made destructive.
      yield* Effect.repeat(Ref.get(opens), {
        schedule: Schedule.spaced(POLL_INTERVAL),
        until: (started) => started > NOT_STARTED,
      });
      const second = yield* Effect.fork(ensuring);
      yield* Deferred.succeed(released, undefined);
      return [yield* Fiber.join(first), yield* Fiber.join(second)] as const;
    }),
    layer,
  );

  return {
    paths,
    opens: yield* Ref.get(opens),
    packed: commands.commands.length,
    entries: yield* fs.readDirectory(cacheDir),
  };
});

describe('one digest is built once for the process, not once per caller', () => {
  test('a second caller joins the build in flight instead of racing it', async () => {
    const { paths, opens, packed, entries } = await run(racingBuilds);

    expect(opens).toBe(ONE_BUILD);
    expect(packed).toBe(ONE_BUILD);
    expect(paths[0]).toBe(paths[1]);
    expect(entries).toEqual([ARTIFACT_DIGEST]);
  });

  test('a build that fails leaves the digest buildable rather than holding its failure', async () => {
    const { failed, retried, opens } = await run(
      Effect.gen(function* () {
        const opens = yield* Ref.make(NOT_STARTED);
        const commands = mksquashfsThat({ code: MKFS_OK });
        const { layer } = yield* imagesOver(
          Layer.merge(unreachableOnceStore(opens), commands.layer),
        );
        return yield* Effect.provide(
          Effect.gen(function* () {
            const failed = yield* Effect.either(ensuring);
            const retried = yield* Effect.either(ensuring);
            return { failed, retried, opens: yield* Ref.get(opens) };
          }),
          layer,
        );
      }),
    );

    expect(Either.isLeft(failed)).toBe(true);
    expect(Either.isRight(retried)).toBe(true);
    expect(opens).toBe(FIRST_ATTEMPT + ONE_BUILD);
  });
});

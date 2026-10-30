import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { emptyDataArchive } from '#lib/nibrunner/artifact.ts';
import { stageNibrunnerArtifacts } from '#lib/nibrunner/stage-artifacts.ts';
import { ArtifactStore } from '#services/artifact-store.service.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST, artifactStore } from '#tests/support/artifacts.ts';
import { artifact, desiredInstance, desiredState, desiredVolume } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const BUCKETS = { artifactBucket: 'binaries', importBucket: 'imports' };

test('binaries and imported archives are verified into one digest-addressed store', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const archive = emptyDataArchive();
      const seed = artifact({
        ...archive,
        objectKey: Value.Parse(ObjectKeySchema, 'seed'),
        sizeBytes: archive.bytes.byteLength,
      });
      const requests: { bucket: string; objectKey: string }[] = [];
      const store = Layer.succeed(
        ArtifactStore,
        ArtifactStore.make({
          open: (request) =>
            Effect.sync(function streamObject() {
              requests.push(request);
              return new Blob([
                request.objectKey === 'seed' ? archive.bytes : ARTIFACT_BYTES,
              ]).stream();
            }),
        }),
      );
      const desired = desiredState({
        volumes: [desiredVolume({ seed })],
        instances: [desiredInstance()],
      });
      const stage = stageNibrunnerArtifacts({ desired, directory, ...BUCKETS }).pipe(
        Effect.provide(store),
      );
      yield* stage;
      expect(new Uint8Array(yield* fs.readFile(`${directory}/${ARTIFACT_DIGEST}`))).toEqual(
        ARTIFACT_BYTES,
      );
      expect(new Uint8Array(yield* fs.readFile(`${directory}/${seed.digest}`))).toEqual(
        archive.bytes,
      );
      expect(requests).toEqual([
        { bucket: BUCKETS.importBucket, objectKey: seed.objectKey },
        { bucket: BUCKETS.artifactBucket, objectKey: desired.instances[0]!.artifact.objectKey },
      ]);
      yield* stage;
      expect(requests).toHaveLength(2);
      expect((yield* fs.readDirectory(directory)).sort()).toEqual(
        [ARTIFACT_DIGEST, seed.digest].sort(),
      );
    }),
  );
});

test('empty data initialization needs no remote object and absent volumes need no seed', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const stage = (desired: ReturnType<typeof desiredState>) =>
        stageNibrunnerArtifacts({
          desired,
          directory,
          ...BUCKETS,
        }).pipe(Effect.provide(artifactStore()));
      yield* stage(
        desiredState({ volumes: [desiredVolume({ desiredState: 'absent', seed: artifact() })] }),
      );
      expect(yield* fs.readDirectory(directory)).toEqual([]);
      yield* stage(desiredState({ volumes: [desiredVolume()] }));
      const archive = emptyDataArchive();
      expect(yield* fs.readDirectory(directory)).toEqual([archive.digest]);
      expect(new Uint8Array(yield* fs.readFile(`${directory}/${archive.digest}`))).toEqual(
        archive.bytes,
      );
    }),
  );
});

test('a failed verification leaves no authoritative object or partial download', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const failed = yield* Effect.flip(
        stageNibrunnerArtifacts({
          desired: desiredState({ instances: [desiredInstance()] }),
          directory,
          ...BUCKETS,
        }).pipe(Effect.provide(artifactStore([new TextEncoder().encode('corrupt')]))),
      );
      expect(failed._tag).toBe('DigestMismatch');
      expect(yield* fs.readDirectory(directory)).toEqual([]);
    }),
  );
});

test('interrupting an unfinished transfer removes its temporary file', async () => {
  await run(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* temporaryDirectory;
      const opened = yield* Deferred.make<void>();
      const store = Layer.succeed(
        ArtifactStore,
        ArtifactStore.make({
          open: () =>
            Deferred.succeed(opened, undefined).pipe(
              Effect.as(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(ARTIFACT_BYTES);
                  },
                }),
              ),
            ),
        }),
      );
      const transfer = yield* Effect.fork(
        stageNibrunnerArtifacts({
          desired: desiredState({ instances: [desiredInstance()] }),
          directory,
          ...BUCKETS,
        }).pipe(Effect.provide(store)),
      );
      yield* Deferred.await(opened);
      expect(yield* fs.exists(`${directory}/${ARTIFACT_DIGEST}`)).toBe(false);
      yield* Fiber.interrupt(transfer);
      expect(yield* fs.readDirectory(directory)).toEqual([]);
    }),
  );
});

import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { type HostReportedState, Sha256DigestSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { emptyDataArchive } from '#artifact.ts';
import { retainedNibrunnerDigests, sweepNibrunnerArtifactCache } from '#artifact-cache.ts';
import { stageNibrunnerArtifacts } from '#stage-artifacts.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST, artifactStore } from '#tests/support/artifacts.ts';
import {
  artifact,
  desiredExport,
  desiredInstance,
  desiredState,
  desiredVolume,
  HOST_ID,
  OBSERVED_AT,
} from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);
const PREVIOUS_DIGEST = Value.Parse(Sha256DigestSchema, 'b'.repeat(ARTIFACT_DIGEST.length));
const OLDER_DIGEST = Value.Parse(Sha256DigestSchema, 'c'.repeat(ARTIFACT_DIGEST.length));
const RUNNING_DIGEST = Value.Parse(Sha256DigestSchema, 'd'.repeat(ARTIFACT_DIGEST.length));
const EXPORTED_DIGEST = Value.Parse(Sha256DigestSchema, 'e'.repeat(ARTIFACT_DIGEST.length));
const SEEDED_DIGEST = Value.Parse(Sha256DigestSchema, 'f'.repeat(ARTIFACT_DIGEST.length));
const OLD_MTIME = new Date(0);

function report(overrides: Partial<HostReportedState> = {}): HostReportedState {
  return {
    hostId: HOST_ID,
    state: 'ready',
    reportedAt: OBSERVED_AT,
    capacity: { vcpuCount: 4, memoryMib: 8192, cacheBytes: 1000 },
    allocatable: { vcpuCount: 3, memoryMib: 7936, cacheBytes: 900 },
    versions: { agent: 'test', guestImage: 'test', firecracker: 'test', zerofs: 'test' },
    instances: [],
    volumes: [],
    checkpoints: [],
    exports: [],
    ...overrides,
  };
}

function retainedDesired() {
  return desiredState({
    retainedArtifactDigests: [ARTIFACT_DIGEST, PREVIOUS_DIGEST],
    instances: [desiredInstance()],
  });
}

test('current, previous, running, import, empty-volume and export bytes are all protected', function protectsDependencies() {
  const desired = {
    ...retainedDesired(),
    volumes: [desiredVolume(), desiredVolume({ seed: artifact({ digest: SEEDED_DIGEST }) })],
    exports: [
      desiredExport({ artifact: { ...artifact({ digest: EXPORTED_DIGEST }), kind: 'executable' } }),
    ],
  };
  const instance = desired.instances[0]!;
  const reported = report({
    instances: [
      {
        appId: instance.appId,
        deploymentId: instance.deploymentId,
        artifactDigest: RUNNING_DIGEST,
        state: 'idle',
        restartCount: 0,
      },
    ],
  });
  expect(retainedNibrunnerDigests({ desired, reported })).toEqual(
    new Set([
      ARTIFACT_DIGEST,
      PREVIOUS_DIGEST,
      RUNNING_DIGEST,
      SEEDED_DIGEST,
      EXPORTED_DIGEST,
      emptyDataArchive().digest,
    ]),
  );
});

test('missing retention metadata and an incomplete runtime view never authorize deletion', function refusesUncertainState() {
  expect(retainedNibrunnerDigests({ desired: desiredState(), reported: report() })).toBeUndefined();
  expect(
    retainedNibrunnerDigests({
      desired: retainedDesired(),
      reported: report({ state: 'unreachable' }),
    }),
  ).toBeUndefined();
  const instance = desiredInstance();
  for (const state of ['pending', 'starting', 'stopping', 'running'] as const) {
    expect(
      retainedNibrunnerDigests({
        desired: retainedDesired(),
        reported: report({
          instances: [
            { appId: instance.appId, deploymentId: instance.deploymentId, state, restartCount: 0 },
          ],
        }),
      }),
    ).toBeUndefined();
  }
});

function cacheFixture() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* temporaryDirectory;
    const artifactStoreDir = `${directory}/artifact-store`;
    const artifactCacheDir = `${directory}/artifacts`;
    const procDir = `${directory}/proc`;
    for (const path of [artifactStoreDir, artifactCacheDir, procDir]) {
      yield* fs.makeDirectory(path);
    }
    function store(digest: string) {
      return Effect.gen(function* () {
        const binary = `${artifactStoreDir}/${digest}`;
        const imageDirectory = `${artifactCacheDir}/${digest}`;
        const image = `${imageDirectory}/executable.squashfs`;
        yield* fs.writeFileString(binary, 'binary');
        yield* fs.makeDirectory(imageDirectory);
        yield* fs.writeFileString(image, 'packed-image');
        for (const path of [binary, image]) {
          yield* fs.utimes(path, OLD_MTIME, OLD_MTIME);
        }
        return { binary, image, imageDirectory };
      });
    }
    return {
      fs,
      directory,
      artifactStoreDir,
      artifactCacheDir,
      procDir,
      store,
      sweep: sweepNibrunnerArtifactCache({
        desired: retainedDesired(),
        reported: report(),
        artifactStoreDir,
        artifactCacheDir,
        procDir,
      }),
    };
  });
}

test('obsolete raw binaries and packed images disappear while the current and previous releases survive', async function evictsOldReleases() {
  await run(
    Effect.gen(function* () {
      const setup = yield* cacheFixture();
      const current = yield* setup.store(ARTIFACT_DIGEST);
      const previous = yield* setup.store(PREVIOUS_DIGEST);
      const obsolete = yield* setup.store(OLDER_DIGEST);
      yield* setup.sweep;
      for (const retained of [current, previous]) {
        expect(yield* setup.fs.readFileString(retained.binary)).toBe('binary');
        expect(yield* setup.fs.readFileString(retained.image)).toBe('packed-image');
      }
      expect(yield* setup.fs.exists(obsolete.binary)).toBe(false);
      expect(yield* setup.fs.exists(obsolete.imageDirectory)).toBe(false);
      yield* setup.sweep;
    }),
  );
});

test('open descriptors, memory mappings and jailer hard links protect files outside the retention set', async function protectsKernelReferences() {
  await run(
    Effect.gen(function* () {
      const setup = yield* cacheFixture();
      const open = yield* setup.store(OLDER_DIGEST);
      const mapped = yield* setup.store(RUNNING_DIGEST);
      yield* setup.fs.makeDirectory(`${setup.procDir}/123/fd`, { recursive: true });
      yield* setup.fs.symlink(open.binary, `${setup.procDir}/123/fd/5`);
      yield* setup.fs.writeFileString(
        `${setup.procDir}/123/maps`,
        `0000-1111 r--p 0000 00:00 1 ${mapped.image}\n`,
      );
      yield* setup.fs.link(open.image, `${setup.directory}/jailer-drive`);
      yield* setup.sweep;
      expect(yield* setup.fs.exists(open.binary)).toBe(true);
      expect(yield* setup.fs.exists(open.image)).toBe(true);
      expect(yield* setup.fs.exists(mapped.binary)).toBe(true);
      expect(yield* setup.fs.exists(mapped.image)).toBe(true);
    }),
  );
});

test('temporary, recent, symlinked and non-digest entries are not collected', async function ignoresUnfinishedAndForeignEntries() {
  await run(
    Effect.gen(function* () {
      const setup = yield* cacheFixture();
      const unfinished = yield* setup.store(OLDER_DIGEST);
      const recent = yield* setup.store(RUNNING_DIGEST);
      yield* setup.fs.writeFileString(`${unfinished.imageDirectory}/layer.tmp`, 'building');
      yield* setup.fs.utimes(recent.binary, new Date(), new Date());
      yield* setup.fs.utimes(recent.image, new Date(), new Date());
      yield* setup.fs.writeFileString(`${setup.artifactStoreDir}/.staging`, 'upload');
      const outside = `${setup.directory}/outside`;
      yield* setup.fs.writeFileString(outside, 'preserve');
      yield* setup.fs.symlink(outside, `${setup.artifactStoreDir}/${EXPORTED_DIGEST}`);
      yield* setup.sweep;
      expect(yield* setup.fs.exists(unfinished.image)).toBe(true);
      expect(yield* setup.fs.exists(unfinished.binary)).toBe(true);
      expect(yield* setup.fs.exists(recent.binary)).toBe(true);
      expect(yield* setup.fs.exists(recent.image)).toBe(true);
      expect(yield* setup.fs.readFileString(`${setup.artifactStoreDir}/.staging`)).toBe('upload');
      expect(yield* setup.fs.readFileString(outside)).toBe('preserve');
    }),
  );
});

test('a failed process inventory leaves every cache file intact', async function requiresProcessVisibility() {
  await run(
    Effect.gen(function* () {
      const setup = yield* cacheFixture();
      const obsolete = yield* setup.store(OLDER_DIGEST);
      yield* setup.fs.remove(setup.procDir, { recursive: true });
      yield* Effect.flip(setup.sweep);
      expect(yield* setup.fs.exists(obsolete.binary)).toBe(true);
      expect(yield* setup.fs.exists(obsolete.image)).toBe(true);
    }),
  );
});

test('evicted binaries are fetched and verified from their original object store when wanted again', async function refetchesEvictedBinary() {
  await run(
    Effect.gen(function* () {
      const setup = yield* cacheFixture();
      const old = yield* setup.store(ARTIFACT_DIGEST);
      yield* sweepNibrunnerArtifactCache({
        desired: desiredState({ retainedArtifactDigests: [] }),
        reported: report(),
        artifactStoreDir: setup.artifactStoreDir,
        artifactCacheDir: setup.artifactCacheDir,
        procDir: setup.procDir,
      });
      expect(yield* setup.fs.exists(old.binary)).toBe(false);
      yield* stageNibrunnerArtifacts({
        desired: retainedDesired(),
        directory: setup.artifactStoreDir,
        artifactBucket: 'binaries',
        importBucket: 'imports',
      }).pipe(Effect.provide(artifactStore()));
      expect(new Uint8Array(yield* setup.fs.readFile(old.binary))).toEqual(ARTIFACT_BYTES);
    }),
  );
});

import { rmdir } from 'node:fs/promises';
import { FileSystem, Path } from '@effect/platform';
import type { HostDesiredState, HostReportedState } from '@repo/protocol';
import { Clock, Data, Effect, Option } from 'effect';
import { emptyDataArchive } from '#lib/nibrunner/artifact.ts';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PROCESS_PATTERN = /^[0-9]+$/;
// The engine may still be opening a freshly published file before its next report.
const MIN_CACHE_AGE_MS = 60_000;
const ALLOCATED_BLOCK_BYTES = 512;

class CacheDirectoryRemovalFailed extends Data.TaggedError('CacheDirectoryRemovalFailed') {
  override get message() {
    return 'The empty artifact cache directory could not be removed.';
  }
}

function desiredCacheDigests(desired: HostDesiredState) {
  const retained = new Set<string>(desired.instances.map((instance) => instance.artifact.digest));
  for (const volume of desired.volumes) {
    if (volume.desiredState === 'present') {
      retained.add(volume.seed?.digest ?? emptyDataArchive().digest);
    }
  }
  for (const item of desired.exports) {
    if (item.desiredState === 'present') {
      retained.add(item.artifact.digest);
    }
  }
  return retained;
}

export function retainedNibrunnerDigests({
  desired,
  reported,
}: {
  desired: HostDesiredState;
  reported: HostReportedState;
}): ReadonlySet<string> | undefined {
  if (
    desired.retainedArtifactDigests === undefined ||
    desired.hostId !== reported.hostId ||
    !['ready', 'draining'].includes(reported.state) ||
    reported.instances.some((instance) =>
      ['pending', 'starting', 'stopping'].includes(instance.state),
    )
  ) {
    return undefined;
  }
  const retained = new Set<string>(desired.retainedArtifactDigests);
  for (const digest of desiredCacheDigests(desired)) {
    retained.add(digest);
  }
  for (const instance of reported.instances) {
    if (instance.state === 'stopped' || instance.state === 'failed') {
      continue;
    }
    if (instance.artifactDigest !== undefined) {
      retained.add(instance.artifactDigest);
    } else {
      return undefined;
    }
  }
  return retained;
}

function fileIdentity(info: FileSystem.File.Info) {
  return Option.map(info.ino, (inode) => `${info.dev}:${inode}`);
}

function ignoreDisappeared<A, E, R>(operation: Effect.Effect<A, E, R>) {
  return operation.pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        'reason' in error &&
        error.reason === 'NotFound',
      () => Effect.succeedNone,
    ),
  );
}

function mappedDigests({ text, cacheRoots }: { text: string; cacheRoots: readonly string[] }) {
  const digests = new Set<string>();
  for (const line of text.split('\n')) {
    for (const root of cacheRoots) {
      const offset = line.indexOf(`${root}/`);
      if (offset === -1) {
        continue;
      }
      const digest = line.slice(offset + root.length + 1).split(/[ /]/)[0];
      if (digest !== undefined && DIGEST_PATTERN.test(digest)) {
        digests.add(digest);
      }
    }
  }
  return digests;
}

const descriptorReferences = Effect.fn('nibrunner.cache.descriptorReferences')(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const identities = new Set<string>();
  const descriptors = yield* ignoreDisappeared(fs.readDirectory(path.join(directory, 'fd')));
  if (Option.isNone(descriptors)) {
    return identities;
  }
  for (const descriptor of descriptors.value) {
    const info = yield* ignoreDisappeared(fs.stat(path.join(directory, 'fd', descriptor)));
    if (Option.isSome(info) && info.value.type === 'File') {
      const identity = fileIdentity(info.value);
      if (Option.isSome(identity)) {
        identities.add(identity.value);
      }
    }
  }
  return identities;
});

const processReferences = Effect.fn('nibrunner.cache.processReferences')(function* ({
  procDir,
  cacheRoots,
}: {
  procDir: string;
  cacheRoots: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const identities = new Set<string>();
  const digests = new Set<string>();
  for (const process of (yield* fs.readDirectory(procDir)).filter((name) =>
    PROCESS_PATTERN.test(name),
  )) {
    const directory = path.join(procDir, process);
    for (const identity of yield* descriptorReferences(directory)) {
      identities.add(identity);
    }
    const maps = yield* ignoreDisappeared(fs.readFileString(path.join(directory, 'maps')));
    if (Option.isSome(maps)) {
      for (const digest of mappedDigests({ text: maps.value, cacheRoots })) {
        digests.add(digest);
      }
    }
  }
  return { identities, digests };
});

const regularEntry = Effect.fn('nibrunner.cache.regularEntry')(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const link = yield* fs.readLink(file).pipe(Effect.option);
  if (Option.isSome(link)) {
    return undefined;
  }
  return Option.getOrUndefined(yield* ignoreDisappeared(fs.stat(file)));
});

function removableFile({
  info,
  openFiles,
  nowMs,
}: {
  info: FileSystem.File.Info;
  openFiles: ReadonlySet<string>;
  nowMs: number;
}) {
  const identity = fileIdentity(info);
  return (
    info.type === 'File' &&
    Option.isSome(info.nlink) &&
    info.nlink.value === 1 &&
    Option.isSome(info.mtime) &&
    nowMs - info.mtime.value.getTime() >= MIN_CACHE_AGE_MS &&
    Option.isSome(identity) &&
    !openFiles.has(identity.value)
  );
}

const imageFiles = Effect.fn('nibrunner.cache.imageFiles')(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const files: string[] = [];
  for (const name of yield* fs.readDirectory(directory)) {
    if (name.startsWith('.') || name.endsWith('.tmp')) {
      return undefined;
    }
    const file = path.join(directory, name);
    const info = yield* regularEntry(file);
    if (info?.type !== 'File') {
      return undefined;
    }
    files.push(file);
  }
  return files;
});

const unfinishedImages = Effect.fn('nibrunner.cache.unfinishedImages')(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const protectedDigests = new Set<string>();
  const root = yield* regularEntry(directory);
  if (root?.type !== 'Directory') {
    return protectedDigests;
  }
  for (const digest of yield* fs.readDirectory(directory)) {
    if (!DIGEST_PATTERN.test(digest)) {
      continue;
    }
    const entry = path.join(directory, digest);
    const info = yield* regularEntry(entry);
    if (info?.type !== 'Directory' || (yield* imageFiles(entry)) === undefined) {
      protectedDigests.add(digest);
    }
  }
  return protectedDigests;
});

const removeCacheEntry = Effect.fn('nibrunner.cache.removeEntry')(function* ({
  entry,
  packed,
  openFiles,
  nowMs,
}: {
  entry: string;
  packed: boolean;
  openFiles: ReadonlySet<string>;
  nowMs: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const info = yield* regularEntry(entry);
  if (info === undefined || info.type !== (packed ? 'Directory' : 'File')) {
    return 0;
  }
  const files = packed ? yield* imageFiles(entry) : [entry];
  if (files === undefined) {
    return 0;
  }
  let reclaimed = 0;
  for (const file of files) {
    const current = yield* regularEntry(file);
    if (current === undefined || !removableFile({ info: current, openFiles, nowMs })) {
      return 0;
    }
    reclaimed += Option.getOrElse(current.blocks, () => 0) * ALLOCATED_BLOCK_BYTES;
  }
  // Unlink only the inspected files; never recursively follow an unexpected cache entry.
  for (const file of files) {
    yield* fs.remove(file);
  }
  if (packed) {
    yield* Effect.tryPromise({
      try: () => rmdir(entry),
      catch: () => new CacheDirectoryRemovalFailed(),
    });
  }
  return reclaimed;
});

export const sweepNibrunnerArtifactCache = Effect.fn('nibrunner.cache.sweep')(function* ({
  desired,
  reported,
  artifactStoreDir,
  artifactCacheDir,
  procDir,
}: {
  desired: HostDesiredState;
  reported: HostReportedState;
  artifactStoreDir: string;
  artifactCacheDir: string;
  procDir: string;
}) {
  const retained = retainedNibrunnerDigests({ desired, reported });
  if (retained === undefined) {
    return;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const roots = [artifactStoreDir, artifactCacheDir];
  const process = yield* processReferences({ procDir, cacheRoots: roots });
  const unfinished = yield* unfinishedImages(artifactCacheDir);
  const nowMs = yield* Clock.currentTimeMillis;
  let reclaimedBytes = 0;
  for (const [index, directory] of roots.entries()) {
    const root = yield* regularEntry(directory);
    if (root?.type !== 'Directory') {
      continue;
    }
    for (const digest of yield* fs.readDirectory(directory)) {
      if (
        !DIGEST_PATTERN.test(digest) ||
        retained.has(digest) ||
        process.digests.has(digest) ||
        unfinished.has(digest)
      ) {
        continue;
      }
      reclaimedBytes += yield* removeCacheEntry({
        entry: path.join(directory, digest),
        packed: index !== 0,
        openFiles: process.identities,
        nowMs,
      });
    }
  }
  if (reclaimedBytes > 0) {
    yield* Effect.logInfo('nibrunner artifact cache reclaimed').pipe(
      Effect.annotateLogs({ reclaimedBytes, retainedDigests: retained.size }),
    );
  }
});

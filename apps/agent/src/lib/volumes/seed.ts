import { posix } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import type { DesiredArtifact, VolumeId } from '@repo/protocol';
import { Data, Effect, Option, Ref, Stream } from 'effect';
import { downloadAndVerify } from '#lib/vm/artifacts.ts';
import { format, isFormatted } from '#lib/volumes/ext4.ts';
import { type TarEntry, tarEntries } from '#lib/volumes/tar.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

/**
 * Who the seed belongs to once it is inside the guest, from `apps/runtime/src/paths.h` — the boot
 * contract, which this end cannot read and has to agree with.
 *
 * `mkfs.ext4 -d` keeps what it finds on the staging tree, and the guest chowns only the mount
 * root, so this is the whole of what makes the tenant's own data writable to them.
 */
const TENANT: Owner = { uid: 65534, gid: 65534 };

const ARCHIVE_FILENAME = 'archive.tar.gz';
const TREE_DIRECTORY = 'tree';
/** The staging tree is one owner's dataset in the clear on a shared host; nobody else may read it. */
const STAGING_MODE = 0o700;
const DIRECTORY_MODE = 0o755;
/**
 * What every unpacked directory carries beyond what the archive said about it.
 *
 * An archive may hold a directory its own owner cannot enter, and reproducing that faithfully
 * would be a tree the unpack cannot write the next entry into and a `data/` the tenant cannot use.
 * The tenant owns every one of these and is the only user in the guest, so the bits this adds are
 * not a boundary anybody is on the other side of — where group and other are left exactly as the
 * archive wrote them.
 */
const OWNER_ACCESS = 0o700;
const GZIP = 'gzip';

const BYTES_PER_GIB = 1_073_741_824;

/** What an unpack will not go past, named by the caller so the bounds can be exercised. */
export type SeedLimits = { readonly maxBytes: number; readonly maxEntries: number };

/**
 * `maxBytes` is how much an archive may come to once it is unpacked. The cap on the upload bounds
 * what was *sent*; what it expands to is decided afterwards, and a quarter of a gibibyte of zeros
 * is a 255 KB download — so the two are not the same bound at all, and this is the one that keeps
 * a host's instance store out of it.
 *
 * Chosen against the room `DISK_RESERVE_GIB` already holds free in `lib/vm/snapshot.ts`: eight
 * gibibytes, whose only other named claim is a checkpoint server's four while an export reads. The
 * archive on disk is at most a gibibyte and the tree at most two, so the worst case is seven of the
 * eight and the arithmetic there needs no change. The tree is transient where ZeroFS's cache is
 * not, which is why it may borrow that room at all.
 *
 * `maxEntries` is what bounds an archive that is headers the whole way down, which the byte ceiling
 * cannot: an entry declaring no data costs nothing against it. Inodes are the resource — a
 * filesystem this size is made with about half a million of them, and an archive needing more would
 * fail the format after the host had already spent the disk staging it.
 */
export const SEED_LIMITS: SeedLimits = { maxBytes: 2 * BYTES_PER_GIB, maxEntries: 200_000 };

export class SeedTooLarge extends Data.TaggedError('SeedTooLarge')<{
  readonly limitBytes: number;
}> {
  override get message() {
    return `the archive holds more than the ${this.limitBytes} bytes an app may be seeded with`;
  }
}

export class SeedTooManyEntries extends Data.TaggedError('SeedTooManyEntries')<{
  readonly limit: number;
}> {
  override get message() {
    return `the archive holds more than the ${this.limit} files an app may be seeded with`;
  }
}

/**
 * An entry the unpack will not write, named by what is wrong with it rather than by its path: a
 * path is the tenant's own text, and this message reaches an operator's log.
 */
export class SeedEntryRefused extends Data.TaggedError('SeedEntryRefused')<{
  readonly reason: string;
}> {
  override get message() {
    return `the archive holds ${this.reason}`;
  }
}

export class SeedUnreadable extends Data.TaggedError('SeedUnreadable')<{
  readonly cause: unknown;
}> {
  override get message() {
    return 'the archive could not be read as a gzipped tarball';
  }
}

/** Who the unpacked tree belongs to, which is the tenant everywhere but a test with no root. */
export type Owner = { readonly uid: number; readonly gid: number };

const ABSOLUTE_PATH = 'an entry whose path starts at the root of a filesystem';
const ESCAPING_PATH = 'an entry whose path climbs out of the archive';
const THROUGH_A_SYMLINK = 'an entry reached through a symlink';
const ESCAPING_LINK = 'a symlink pointing out of the archive';
const NOT_A_FILE = 'something that is not a file, a directory or a symlink';

/**
 * What the unpack has written so far, and what it has to know to refuse the next entry.
 *
 * `symlinks` is what makes the containment check hold at all: an entry is refused for pointing out
 * of the tree, and an entry underneath one that already does would reach the same place without
 * ever saying so.
 */
type Unpacked = {
  readonly bytes: number;
  readonly entries: number;
  readonly symlinks: ReadonlySet<string>;
};

const EMPTY: Unpacked = { bytes: 0, entries: 0, symlinks: new Set() };

/**
 * The archive's path as the segments of it that mean anything, or nothing where it is one the
 * unpack will not write. Absolute and climbing are refused rather than corrected: what an owner
 * uploaded is the root of `data/`, so either is an archive that was not made for this.
 *
 * No segments at all is the archive's own root, which `tar cf archive.tar .` writes as `./` and
 * every path under it as `./…`. It names the tree rather than anything in it, so there is nothing
 * to write for it and nothing wrong with it.
 */
function segmentsOf(path: string): Option.Option<readonly string[]> {
  if (path.startsWith('/')) {
    return Option.none();
  }
  const segments = path.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  return segments.some((segment) => segment === '..') ? Option.none() : Option.some(segments);
}

/** Whether anything above this entry is a symlink, which is the only way one could be followed. */
function reachedThroughSymlink({
  segments,
  symlinks,
}: {
  segments: readonly string[];
  symlinks: ReadonlySet<string>;
}): boolean {
  for (let depth = 1; depth < segments.length; depth += 1) {
    if (symlinks.has(segments.slice(0, depth).join('/'))) {
      return true;
    }
  }
  return false;
}

/** Whether a symlink's target, read from where the symlink sits, lands back inside the archive. */
function pointsInside({ segments, target }: { segments: readonly string[]; target: string }) {
  if (target.startsWith('/')) {
    return false;
  }
  const resolved = posix.normalize(posix.join(segments.slice(0, -1).join('/'), target));
  return resolved !== '..' && !resolved.startsWith('../');
}

function refuse(reason: string) {
  return Effect.fail(new SeedEntryRefused({ reason }));
}

/**
 * Owned by the tenant as it is written, rather than chowned in a second pass.
 *
 * `mkfs.ext4 -d` copies what it finds, and the guest chowns only the mount root — so an unchowned
 * tree is a `data/` the tenant can read and not write, which is the failure this exists to prevent
 * and the one nothing on the host would notice.
 */
const owned = ({ path, owner }: { path: string; owner: Owner }) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.chown(path, owner.uid, owner.gid));

const madeDirectory = ({ path, mode, owner }: { path: string; mode: number; owner: Owner }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path, { recursive: true, mode });
    yield* owned({ path, owner });
  });

/**
 * A file's own bytes, written straight through rather than held: an entry is as large as the
 * ceiling allows, and buffering one would be the whole of it in the agent's memory.
 */
const wroteFile = ({ entry, path, owner }: { entry: TarEntry; path: string; owner: Owner }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* madeDirectory({ path: posix.dirname(path), mode: DIRECTORY_MODE, owner });
    yield* Stream.fromAsyncIterable(entry.content(), (cause) => new SeedUnreadable({ cause })).pipe(
      Stream.run(fs.sink(path)),
    );
    // Permissions only, and never the bits above them: a setuid file the host wrote would be one
    // the host is briefly carrying, and one `mkfs.ext4 -d` would copy into the tenant's filesystem.
    yield* fs.chmod(path, entry.mode);
    yield* owned({ path, owner });
  });

/**
 * A symlink is created rather than followed, and its ownership left alone: what a symlink permits
 * is decided by what it points at, and chowning one would chown that instead.
 */
const wroteSymlink = ({ entry, path, owner }: { entry: TarEntry; path: string; owner: Owner }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* madeDirectory({ path: posix.dirname(path), mode: DIRECTORY_MODE, owner });
    yield* fs.symlink(entry.linkTarget, path);
  });

const wroteEntry = ({
  entry,
  segments,
  destination,
  owner,
}: {
  entry: TarEntry;
  segments: readonly string[];
  destination: string;
  owner: Owner;
}) => {
  const path = posix.join(destination, ...segments);
  if (entry.kind === 'directory') {
    return madeDirectory({ path, mode: entry.mode | OWNER_ACCESS, owner });
  }
  return entry.kind === 'file'
    ? wroteFile({ entry, path, owner })
    : wroteSymlink({ entry, path, owner });
};

const advanced = ({
  unpacked,
  entry,
  segments,
}: {
  unpacked: Unpacked;
  entry: TarEntry;
  segments: readonly string[];
}): Unpacked => ({
  bytes: unpacked.bytes + entry.sizeBytes,
  entries: unpacked.entries + 1,
  symlinks:
    entry.kind === 'symlink'
      ? new Set([...unpacked.symlinks, segments.join('/')])
      : unpacked.symlinks,
});

/**
 * One entry, refused or written.
 *
 * The ceilings are checked against what the header declares, before the bytes are spent: an entry
 * cannot deliver more than it declared — the walk stops at the length it was given — so refusing
 * on the declaration is refusing before the disk goes rather than after.
 */
const unpackedEntry = ({
  unpacked,
  entry,
  destination,
  owner,
  limits,
}: {
  unpacked: Unpacked;
  entry: TarEntry;
  destination: string;
  owner: Owner;
  limits: SeedLimits;
}): Effect.Effect<
  Unpacked,
  SeedEntryRefused | SeedTooLarge | SeedTooManyEntries | SeedUnreadable | PlatformError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (entry.kind === 'unsupported') {
      return yield* refuse(NOT_A_FILE);
    }
    const segments = yield* Option.match(segmentsOf(entry.path), {
      onNone: () => refuse(refusalFor(entry.path)),
      onSome: Effect.succeed,
    });
    if (segments.length === 0) {
      return unpacked;
    }
    if (reachedThroughSymlink({ segments, symlinks: unpacked.symlinks })) {
      return yield* refuse(THROUGH_A_SYMLINK);
    }
    if (entry.kind === 'symlink' && !pointsInside({ segments, target: entry.linkTarget })) {
      return yield* refuse(ESCAPING_LINK);
    }
    const next = advanced({ unpacked, entry, segments });
    if (next.bytes > limits.maxBytes) {
      return yield* new SeedTooLarge({ limitBytes: limits.maxBytes });
    }
    if (next.entries > limits.maxEntries) {
      return yield* new SeedTooManyEntries({ limit: limits.maxEntries });
    }
    yield* wroteEntry({ entry, segments, destination, owner });
    return next;
  });

function refusalFor(path: string): string {
  return path.startsWith('/') ? ABSOLUTE_PATH : ESCAPING_PATH;
}

/**
 * The archive's root becomes the root of `data/`, so nothing is stripped and no leading directory
 * is looked for. An export bundle nests its dataset under `data/` beside the binary, which is why
 * one does not round-trip through here — restoring from an export is its own thing.
 */
export const unpackSeed = Effect.fn('unpackSeed')(function* ({
  archivePath,
  destination,
  owner,
  limits,
}: {
  archivePath: string;
  destination: string;
  owner: Owner;
  limits: SeedLimits;
}) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(destination, { recursive: true, mode: STAGING_MODE });
  yield* owned({ path: destination, owner });

  const entries = yield* Effect.try({
    try: () =>
      tarEntries(Bun.file(archivePath).stream().pipeThrough(new DecompressionStream(GZIP))),
    catch: (cause) => new SeedUnreadable({ cause }),
  });

  const progress = yield* Ref.make(EMPTY);
  yield* Stream.fromAsyncIterable(entries, (cause) => new SeedUnreadable({ cause })).pipe(
    Stream.runForEach((entry) =>
      Ref.get(progress).pipe(
        Effect.flatMap((unpacked) =>
          unpackedEntry({ unpacked, entry, destination, owner, limits }),
        ),
        Effect.flatMap((next) => Ref.set(progress, next)),
      ),
    ),
  );

  const unpacked = yield* Ref.get(progress);
  yield* Effect.annotateCurrentSpan({ entries: unpacked.entries, bytes: unpacked.bytes });
  return unpacked;
});

/**
 * A fresh filesystem with the owner's archive already in it, or nothing to do because there is
 * already a filesystem here.
 *
 * The formatted check is asked before anything is downloaded, and `format` asks it again as the
 * only thing that decides: what stands between them is a transfer of up to a gibibyte and a
 * staging tree of up to two, and a device that already has a filesystem is worth answering before
 * either is spent.
 *
 * Nothing is left behind on the way out, whichever way it goes. The archive and the tree it
 * expands to are the owner's whole dataset in the clear on a host their app shares with others,
 * and neither has any use once the filesystem carries it.
 */
export const formatFromSeed = Effect.fn('formatFromSeed')(function* ({
  devicePath,
  volumeId,
  seed,
}: {
  devicePath: string;
  volumeId: VolumeId;
  seed: DesiredArtifact;
}) {
  yield* Effect.annotateCurrentSpan({ devicePath, volumeId });
  const config = yield* AgentConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  if (yield* isFormatted(devicePath)) {
    return false;
  }

  const stagingDir = path.join(config.seedStagingDir, volumeId);
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      yield* fs.makeDirectory(stagingDir, { recursive: true, mode: STAGING_MODE });
      const archivePath = path.join(stagingDir, ARCHIVE_FILENAME);
      yield* downloadAndVerify({
        artifact: seed,
        destination: archivePath,
        bucket: config.importBucket,
      });
      const tree = path.join(stagingDir, TREE_DIRECTORY);
      const unpacked = yield* unpackSeed({
        archivePath,
        destination: tree,
        owner: TENANT,
        limits: SEED_LIMITS,
      });
      // Before the format rather than after it, so the disk the filesystem is written through is
      // not also holding the copy it was written from.
      yield* fs.remove(archivePath, { force: true });
      yield* Effect.logInfo('volume seed unpacked').pipe(
        Effect.annotateLogs({ volumeId, entries: unpacked.entries, bytes: unpacked.bytes }),
      );
      return yield* format({ devicePath, seedDir: Option.some(tree) });
    }),
    fs.remove(stagingDir, { recursive: true, force: true }).pipe(Effect.ignore),
  );
});

/**
 * Cleanup that does not depend on this process having made the mess, for the reason the export
 * staging tree is reaped the same way: ending the scope covers the seed that failed, and nothing
 * in-process covers an agent killed between unpacking a tree and formatting from it — which is a
 * tenant's whole dataset left in the clear on a shared host.
 *
 * At startup rather than every pass, because unlike an export checkpoint nothing else on the host
 * is held hostage by one: what is left behind costs disk until the next restart and nothing else,
 * and a pass that ran this would have to know it was not looking at a seed in progress.
 */
export const reapSeedStaging = Effect.gen(function* () {
  const config = yield* AgentConfig;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(config.seedStagingDir, { recursive: true, force: true });
}).pipe(
  Effect.catchAll((error) =>
    Effect.logError('volume seeds left behind could not be reaped', error),
  ),
  Effect.withSpan('reapSeedStaging'),
);

import { basename } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact } from '@repo/protocol';
import { Data, Duration, Effect, Either } from 'effect';
import { BINARY_MODE, downloadAndVerify } from '#lib/vm/artifacts.ts';
import { MKFS_ROOT_ENTRIES } from '#lib/volumes/ext4.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const STAGING_MODE = 0o700;
const DATA_DIRECTORY = 'data';
const BUNDLE_NAME = 'bundle.tar.gz';
/** A tenant filesystem is unbounded, and the default would abort a large export part-way. */
const DUMP_TIMEOUT = Duration.hours(1);

export class EmptyDump extends Data.TaggedError('EmptyDump')<{
  readonly devicePath: string;
}> {
  override get message() {
    return `reading ${this.devicePath} produced no files`;
  }
}

export class UnsafeFilename extends Data.TaggedError('UnsafeFilename')<{
  readonly filename: string;
}> {
  override get message() {
    return `${this.filename} is a path rather than a filename`;
  }
}

/**
 * Read with `debugfs`, which walks inodes in userspace: the bundle is built from a filesystem the
 * host never asks its kernel to interpret. Mounting it — even read-only — would give that up.
 *
 * `debugfs` reports a failed `rdump` on stderr and still exits 0, so an empty destination is the
 * only reliable signal that nothing came out.
 */
const dumpFilesystem = ({ devicePath, destination }: { devicePath: string; destination: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(destination, { recursive: true, mode: STAGING_MODE });
    yield* stdoutOf({
      command: ['debugfs', '-R', `rdump / ${destination}`, devicePath],
      timeout: DUMP_TIMEOUT,
    });
    if ((yield* fs.readDirectory(destination)).length === 0) {
      return yield* new EmptyDump({ devicePath });
    }
    // Dropped after the emptiness check and never before it: a filesystem holding nothing but
    // `lost+found` is a tenant who has written no data, and removing it first would report that
    // as a dump that failed.
    yield* Effect.forEach(
      MKFS_ROOT_ENTRIES,
      (entry) => fs.remove(path.join(destination, entry), { recursive: true, force: true }),
      { discard: true },
    );
  });

/**
 * Re-checked rather than trusted from the wire, and refused rather than corrected: this becomes a
 * path inside an archive somebody extracts on their own machine, and the schema already
 * constrains it, so anything else came from a peer that did not honour the contract.
 */
export function bundleBinaryName(artifact: DesiredArtifact): Either.Either<string, UnsafeFilename> {
  const { filename } = artifact;
  return filename !== basename(filename) || filename.startsWith('.') || filename.startsWith('-')
    ? Either.left(new UnsafeFilename({ filename }))
    : Either.right(filename);
}

/**
 * Kept apart from the archive step because this is the only part of an export a frozen tenant
 * pays for. Everything after it reads the staging tree rather than the device, so holding the
 * guest still through a binary download and a `tar` of the whole dataset would block writes for
 * several times as long as reading the device does.
 */
export const dumpVolume = Effect.fn('dumpVolume')(function* ({
  devicePath,
  stagingDir,
}: {
  devicePath: string;
  stagingDir: string;
}) {
  yield* Effect.annotateCurrentSpan({ devicePath });
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.remove(stagingDir, { recursive: true, force: true });
  yield* fs.makeDirectory(stagingDir, { recursive: true, mode: STAGING_MODE });

  yield* dumpFilesystem({ devicePath, destination: path.join(stagingDir, DATA_DIRECTORY) });
});

/**
 * The binary is fetched from the artifact bucket rather than lifted out of the local squashfs
 * cache, because the download proves the digest on the way past.
 */
export const writeBundle = Effect.fn('writeBundle')(function* ({
  artifact,
  stagingDir,
}: {
  artifact: DesiredArtifact;
  stagingDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const binaryName = yield* bundleBinaryName(artifact);

  const binaryPath = path.join(stagingDir, binaryName);
  yield* downloadAndVerify({ artifact, destination: binaryPath });
  // A transfer writes what a transfer writes, and `tar` records the mode it finds. Without this
  // the bundle carries a binary the owner has to chmod before the copy they were handed will run.
  yield* fs.chmod(binaryPath, BINARY_MODE);

  const bundlePath = path.join(stagingDir, BUNDLE_NAME);
  yield* stdoutOf({
    // Named entries rather than `.`, which would sweep the archive into itself.
    command: ['tar', 'czf', bundlePath, '-C', stagingDir, DATA_DIRECTORY, binaryName],
    timeout: DUMP_TIMEOUT,
  });

  return { path: bundlePath, sizeBytes: Number((yield* fs.stat(bundlePath)).size) };
});

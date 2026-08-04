import { basename } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact } from '@repo/protocol';
import { Data, Duration, Effect, Either } from 'effect';
import { stdoutOf } from '#lib/exec.ts';
import { downloadAndVerify } from '#vm/artifacts.ts';

const STAGING_MODE = 0o700;
const DATA_DIRECTORY = 'data';
const BUNDLE_NAME = 'bundle.tar.gz';
/** A tenant filesystem is unbounded, and the default would abort a large export part-way. */
const DUMP_TIMEOUT = Duration.hours(1);

export class EmptyDump extends Data.TaggedError('EmptyDump')<{
  readonly devicePath: string;
}> {}

export class UnsafeFilename extends Data.TaggedError('UnsafeFilename')<{
  readonly filename: string;
}> {}

/**
 * Read with `debugfs`, which walks inodes in userspace: the bundle is built from a filesystem the
 * host never asks its kernel to interpret. Mounting it — even read-only — would give that up.
 *
 * `debugfs` reports a failed `rdump` on stderr and still exits 0, so an empty destination is the
 * only reliable signal that nothing came out.
 */
const dumpFilesystem = ({
  devicePath,
  destination,
}: {
  devicePath: string;
  destination: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(destination, { recursive: true, mode: STAGING_MODE });
    yield* stdoutOf({
      command: ['debugfs', '-R', `rdump / ${destination}`, devicePath],
      timeout: DUMP_TIMEOUT,
    });
    if ((yield* fs.readDirectory(destination)).length === 0) {
      return yield* new EmptyDump({ devicePath });
    }
  });

/**
 * Re-checked rather than trusted from the wire, and refused rather than corrected: this becomes a
 * path inside an archive somebody extracts on their own machine, and the schema already
 * constrains it, so anything else came from a peer that did not honour the contract.
 */
export function bundleBinaryName(
  artifact: DesiredArtifact,
): Either.Either<string, UnsafeFilename> {
  const { filename } = artifact;
  return filename !== basename(filename) || filename.startsWith('.') || filename.startsWith('-')
    ? Either.left(new UnsafeFilename({ filename }))
    : Either.right(filename);
}

/**
 * The binary is fetched from the artifact bucket rather than lifted out of the local squashfs
 * cache, because the download proves the digest on the way past.
 */
export const writeBundle = ({
  artifact,
  devicePath,
  stagingDir,
}: {
  artifact: DesiredArtifact;
  devicePath: string;
  stagingDir: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binaryName = yield* bundleBinaryName(artifact);

    yield* fs.remove(stagingDir, { recursive: true, force: true });
    yield* fs.makeDirectory(stagingDir, { recursive: true, mode: STAGING_MODE });

    yield* dumpFilesystem({ devicePath, destination: path.join(stagingDir, DATA_DIRECTORY) });
    yield* downloadAndVerify({ artifact, destination: path.join(stagingDir, binaryName) });

    const bundlePath = path.join(stagingDir, BUNDLE_NAME);
    yield* stdoutOf({
      // Named entries rather than `.`, which would sweep the archive into itself.
      command: ['tar', 'czf', bundlePath, '-C', stagingDir, DATA_DIRECTORY, binaryName],
      timeout: DUMP_TIMEOUT,
    });

    return { path: bundlePath, sizeBytes: Number((yield* fs.stat(bundlePath)).size) };
  });

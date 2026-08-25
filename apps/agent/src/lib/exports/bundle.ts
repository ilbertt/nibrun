import { basename } from 'node:path';
import { FileSystem, Path } from '@effect/platform';
import type { DesiredArtifact, TenantEnvironment } from '@repo/protocol';
import { Data, Duration, Effect, Either } from 'effect';
import { BINARY_MODE, downloadAndVerify } from '#lib/vm/artifacts.ts';
import { MKFS_ROOT_ENTRIES } from '#lib/volumes/ext4.ts';
import { stdoutOf } from '#services/command-runner.service.ts';

const STAGING_MODE = 0o700;
const DATA_DIRECTORY = 'data';
const ENV_FILENAME = '.env';
/** The tenant's environment in the clear, which is what it is for and why nobody else may read it. */
const ENV_MODE = 0o600;
const BUNDLE_NAME = 'bundle.tar.gz';
/**
 * A tenant filesystem is unbounded, and the default would abort a large export part-way.
 *
 * An hour is now a number that can actually be reached. It used to sit under the guest's own
 * 15-minute freeze ceiling, which ended the export at a quarter of it and made a filesystem
 * slower than that to read impossible to export at all. The read runs against a checkpoint with
 * nobody frozen behind it, so the two bound different things — that one the cut, this one the
 * read — rather than being two answers to the same question.
 */
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
 * Quoted, where the config drive's `instance.env` refuses a value it cannot represent instead.
 * The two have different readers: that one is parsed by an init with no parser, so a value it
 * cannot carry is an instance that must not boot, while this one is read by whatever the owner
 * runs the binary under next — and an export is the last thing that may fail on a value somebody
 * set. So the escaping is dotenv's, and a newline becomes `\n` rather than the end of the line.
 */
export function renderDotenv(environment: TenantEnvironment): string {
  return Object.keys(environment)
    .sort()
    .map((name) => `${name}=${quoted(environment[name] ?? '')}\n`)
    .join('');
}

function quoted(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
}

/**
 * Kept apart from the archive step because this is the part that needs a device attached, and
 * behind that device a checkpoint pinning every segment on the host against reclamation.
 * Everything after it reads the staging tree instead, so a binary download and a `tar` of the
 * whole dataset happen with nothing pinned.
 *
 * No tenant is frozen through this any more — what they pay for is the cut, which is over before
 * this starts.
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
  environment,
  stagingDir,
}: {
  artifact: DesiredArtifact;
  environment: TenantEnvironment | undefined;
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

  // An empty file for an app that set no variables, and no file at all when the control plane
  // could not say what it was configured with: the first is an answer, and the second would be an
  // empty file pretending to be one.
  if (environment !== undefined) {
    yield* fs.writeFileString(path.join(stagingDir, ENV_FILENAME), renderDotenv(environment), {
      mode: ENV_MODE,
    });
  }

  const bundlePath = path.join(stagingDir, BUNDLE_NAME);
  yield* stdoutOf({
    // Named entries rather than `.`, which would sweep the archive into itself.
    command: [
      'tar',
      'czf',
      bundlePath,
      '-C',
      stagingDir,
      DATA_DIRECTORY,
      binaryName,
      ...(environment === undefined ? [] : [ENV_FILENAME]),
    ],
    timeout: DUMP_TIMEOUT,
  });

  return { path: bundlePath, sizeBytes: Number((yield* fs.stat(bundlePath)).size) };
});

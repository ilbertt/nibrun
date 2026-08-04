import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { DesiredArtifact } from '@repo/protocol';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';
import { type ArtifactBytes, downloadAndVerify } from '#vm/artifacts.ts';

const STAGING_MODE = 0o700;
const DATA_DIRECTORY = 'data';
const BUNDLE_NAME = 'bundle.tar.gz';
// A tenant filesystem is unbounded where every other subprocess here is not, and the default
// would abort a large export part-way with nothing to distinguish it from a broken device.
const DUMP_TIMEOUT_MS = 3_600_000;

export class EmptyDumpError extends Error {
  constructor(devicePath: string) {
    super(`debugfs produced nothing from ${devicePath}`);
    this.name = 'EmptyDumpError';
  }
}

export class UnsafeFilenameError extends Error {
  constructor(filename: string) {
    super(`Refusing to write ${JSON.stringify(filename)} into a bundle: it is not a filename`);
    this.name = 'UnsafeFilenameError';
  }
}

/**
 * Reads the tenant's filesystem with `debugfs`, which walks inodes in userspace.
 *
 * This is the rule from `volumes/ext4.ts` held at its sharpest: the bundle is built from a
 * filesystem the host never asks its kernel to interpret, so a malformed or hostile image is a
 * userspace failure rather than a host one. Mounting it — even read-only — would hand
 * tenant-controlled metadata to the kernel and give up the property the design is built on.
 *
 * `debugfs` reports a failed `rdump` on stderr and still exits 0, so an empty destination is
 * the only reliable signal that nothing came out.
 */
async function dumpFilesystem({
  runner,
  devicePath,
  destination,
}: {
  runner: CommandRunner;
  devicePath: string;
  destination: string;
}): Promise<void> {
  await mkdir(destination, { recursive: true, mode: STAGING_MODE });
  await runCommandOrThrow({
    runner,
    request: {
      command: ['debugfs', '-R', `rdump / ${destination}`, devicePath],
      timeoutMs: DUMP_TIMEOUT_MS,
    },
  });
  if ((await readdir(destination)).length === 0) {
    throw new EmptyDumpError(devicePath);
  }
}

/**
 * The name the binary takes inside the bundle.
 *
 * Re-checked rather than trusted from the wire, and refused rather than corrected. The schema
 * already constrains it to a single segment, so anything reaching here that is not one came
 * from a peer that did not honour the contract — and this value becomes a path inside an
 * archive somebody extracts on their own machine. Renaming it quietly would leave both the
 * broken control plane and the attempt unnoticed.
 */
export function bundleBinaryName(artifact: DesiredArtifact): string {
  const { filename } = artifact;
  if (filename !== basename(filename) || filename.startsWith('.') || filename.startsWith('-')) {
    throw new UnsafeFilenameError(filename);
  }
  return filename;
}

/**
 * Builds the downloadable copy of one app: the binary it runs and the filesystem it wrote.
 *
 * The binary is fetched from the artifact bucket rather than lifted out of the local squashfs
 * cache, because `downloadAndVerify` proves the digest on the way past and unpacking a squashfs
 * would prove nothing about what is inside it.
 */
export async function writeBundle({
  runner,
  artifacts,
  artifact,
  devicePath,
  stagingDir,
}: {
  runner: CommandRunner;
  artifacts: ArtifactBytes;
  artifact: DesiredArtifact;
  devicePath: string;
  stagingDir: string;
}): Promise<{ path: string; sizeBytes: number }> {
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true, mode: STAGING_MODE });

  const binaryName = bundleBinaryName(artifact);
  await dumpFilesystem({ runner, devicePath, destination: join(stagingDir, DATA_DIRECTORY) });
  await downloadAndVerify({
    source: artifacts,
    artifact,
    destination: join(stagingDir, binaryName),
  });

  const bundlePath = join(stagingDir, BUNDLE_NAME);
  await runCommandOrThrow({
    runner,
    request: {
      // Named entries rather than `.`, which would sweep the archive into itself.
      command: ['tar', 'czf', bundlePath, '-C', stagingDir, DATA_DIRECTORY, binaryName],
      timeoutMs: DUMP_TIMEOUT_MS,
    },
  });

  return { path: bundlePath, sizeBytes: (await stat(bundlePath)).size };
}

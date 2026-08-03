import { chmod, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import type { InstanceCredentialProvider } from '#aws/instance-credentials.ts';
import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';
const SQUASHFS_FILENAME = 'artifact.squashfs';
// The path the guest's init execs. Fixed by the boot contract, not configurable.
const GUEST_BINARY_NAME = 'server';
const BINARY_MODE = 0o755;
const CACHE_DIR_MODE = 0o755;

export class DigestMismatchError extends Error {
  readonly expected: Sha256Digest;
  readonly actual: string;

  constructor({ expected, actual }: { expected: Sha256Digest; actual: string }) {
    super(`Artifact digest mismatch: expected ${expected}, got ${actual}`);
    this.name = 'DigestMismatchError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class ArtifactSizeError extends Error {
  constructor({ expected, actual }: { expected: number; actual: number }) {
    super(`Artifact is ${actual} bytes, expected ${expected}`);
    this.name = 'ArtifactSizeError';
  }
}

// Content-addressed, so a redeploy of an artifact this host has already seen costs nothing and
// two apps on the same binary share one squashfs.
export const artifactDirectory = ({
  cacheDir,
  digest,
}: {
  cacheDir: string;
  digest: Sha256Digest;
}) => join(cacheDir, digest);

export const artifactImagePath = (options: { cacheDir: string; digest: Sha256Digest }) =>
  join(artifactDirectory(options), SQUASHFS_FILENAME);

export type ArtifactBytes = {
  open(objectKey: string): Promise<ReadableStream<Uint8Array>>;
};

export function s3ArtifactBytes({
  bucket,
  region,
  credentials,
}: {
  bucket: string;
  region: string;
  credentials: InstanceCredentialProvider;
}): ArtifactBytes {
  return {
    async open(objectKey: string) {
      const resolved = await credentials.resolve();
      const client = new Bun.S3Client({
        bucket,
        region,
        accessKeyId: resolved.accessKeyId,
        secretAccessKey: resolved.secretAccessKey,
        ...(resolved.sessionToken ? { sessionToken: resolved.sessionToken } : {}),
      });
      return client.file(objectKey).stream();
    },
  };
}

/**
 * Streams the artifact to disk while hashing it, and verifies before anything can execute it.
 *
 * The digest is the artifact's identity as far as a host is concerned; the object key is only
 * where the bytes happened to be. Hashing during the transfer rather than after it means the
 * bytes are never read twice, and the file is only ever moved into the content-addressed cache
 * once it has been proven to be what it claims.
 */
export async function downloadAndVerify({
  source,
  artifact,
  destination,
}: {
  source: ArtifactBytes;
  artifact: DesiredArtifact;
  destination: string;
}): Promise<void> {
  const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
  const writer = Bun.file(destination).writer();
  let written = 0;
  try {
    for await (const chunk of await source.open(artifact.objectKey)) {
      hasher.update(chunk);
      writer.write(chunk);
      written += chunk.byteLength;
    }
    await writer.end();
  } catch (error) {
    await writer.end();
    await rm(destination, { force: true });
    throw error;
  }

  const actual = hasher.digest(HEX_ENCODING);
  if (actual !== artifact.digest) {
    await rm(destination, { force: true });
    throw new DigestMismatchError({ expected: artifact.digest, actual });
  }
  if (written !== artifact.sizeBytes) {
    await rm(destination, { force: true });
    throw new ArtifactSizeError({ expected: artifact.sizeBytes, actual: written });
  }
}

export async function digestOfFile({ path }: { path: string }): Promise<string> {
  const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest(HEX_ENCODING);
}

/**
 * Returns the path of the read-only squashfs the guest attaches as `vdb`, building it if this
 * host has not seen the digest before.
 */
export async function ensureArtifactImage({
  source,
  runner,
  cacheDir,
  artifact,
}: {
  source: ArtifactBytes;
  runner: CommandRunner;
  cacheDir: string;
  artifact: DesiredArtifact;
}): Promise<string> {
  const imagePath = artifactImagePath({ cacheDir, digest: artifact.digest });
  if (await Bun.file(imagePath).exists()) {
    return imagePath;
  }

  const stagingDir = join(cacheDir, `.staging-${artifact.digest}`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true, mode: CACHE_DIR_MODE });
  try {
    const binaryPath = join(stagingDir, GUEST_BINARY_NAME);
    await downloadAndVerify({ source, artifact, destination: binaryPath });
    await chmod(binaryPath, BINARY_MODE);

    const stagedImage = `${stagingDir}.squashfs`;
    await rm(stagedImage, { force: true });
    await runCommandOrThrow({
      runner,
      request: { command: ['mksquashfs', stagingDir, stagedImage, '-no-progress', '-noappend'] },
    });
    await mkdir(artifactDirectory({ cacheDir, digest: artifact.digest }), {
      recursive: true,
      mode: CACHE_DIR_MODE,
    });
    await rename(stagedImage, imagePath);
    return imagePath;
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

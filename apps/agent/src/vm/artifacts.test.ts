import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesiredArtifact, Filename, ObjectKey, Sha256Digest } from '@repo/protocol';
import {
  type ArtifactBytes,
  ArtifactSizeError,
  artifactImagePath,
  DigestMismatchError,
  digestOfFile,
  downloadAndVerify,
} from '#vm/artifacts.ts';

const CONTENT = new TextEncoder().encode('#!/usr/bin/env fake-binary\n');
const CONTENT_DIGEST = new Bun.CryptoHasher('sha256').update(CONTENT).digest('hex') as Sha256Digest;
const DIGEST_HEX_LENGTH = 64;
const WRONG_DIGEST = 'b'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest;

const bytesOf = (chunks: Uint8Array[]): ArtifactBytes => ({
  open: () =>
    Promise.resolve(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
    ),
});

function artifact(overrides: Partial<DesiredArtifact> = {}): DesiredArtifact {
  return {
    digest: CONTENT_DIGEST,
    sizeBytes: CONTENT.byteLength,
    objectKey: 'artifacts/app-1/binary' as ObjectKey,
    filename: 'server' as Filename,
    ...overrides,
  };
}

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'nibrun-artifacts-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the digest is verified before anything can execute', () => {
  test('matching bytes are written and kept', async () => {
    const destination = join(directory, 'server');
    await downloadAndVerify({ source: bytesOf([CONTENT]), artifact: artifact(), destination });
    expect(await digestOfFile({ path: destination })).toBe(CONTENT_DIGEST);
  });

  test('a mismatched digest throws and leaves nothing behind', async () => {
    const destination = join(directory, 'server');
    await expect(
      downloadAndVerify({
        source: bytesOf([CONTENT]),
        artifact: artifact({ digest: WRONG_DIGEST }),
        destination,
      }),
    ).rejects.toThrow(DigestMismatchError);
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test('bytes tampered with mid-stream are caught, not just a wrong first chunk', async () => {
    const destination = join(directory, 'server');
    const tampered = new Uint8Array(CONTENT);
    tampered[tampered.length - 1] = 0;
    await expect(
      downloadAndVerify({ source: bytesOf([tampered]), artifact: artifact(), destination }),
    ).rejects.toThrow(DigestMismatchError);
  });

  test('a size that disagrees with the manifest is rejected even when the digest matches', async () => {
    const destination = join(directory, 'server');
    await expect(
      downloadAndVerify({
        source: bytesOf([CONTENT]),
        artifact: artifact({ sizeBytes: CONTENT.byteLength + 1 }),
        destination,
      }),
    ).rejects.toThrow(ArtifactSizeError);
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test('a stream split across chunks hashes the same as one chunk', async () => {
    const destination = join(directory, 'server');
    const half = Math.floor(CONTENT.byteLength / 2);
    await downloadAndVerify({
      source: bytesOf([CONTENT.slice(0, half), CONTENT.slice(half)]),
      artifact: artifact(),
      destination,
    });
    expect(await digestOfFile({ path: destination })).toBe(CONTENT_DIGEST);
  });
});

describe('the cache is content-addressed', () => {
  test('the path depends only on the digest, so a redeploy of the same bytes is free', () => {
    expect(
      artifactImagePath({ cacheDir: '/var/lib/nibrun/artifacts', digest: CONTENT_DIGEST }),
    ).toBe(`/var/lib/nibrun/artifacts/${CONTENT_DIGEST}/artifact.squashfs`);
  });
});

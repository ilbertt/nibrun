import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Path } from '@effect/platform';
import { BunPath } from '@effect/platform-bun';
import type { DesiredArtifact, Filename, ObjectKey, Sha256Digest } from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { platform } from '#testing.ts';
import { ArtifactStore, artifactImagePath, downloadAndVerify } from '#vm/artifacts.ts';

const CONTENT = new TextEncoder().encode('#!/usr/bin/env fake-binary\n');
const CONTENT_DIGEST = new Bun.CryptoHasher('sha256').update(CONTENT).digest('hex') as Sha256Digest;
const DIGEST_HEX_LENGTH = 64;
const WRONG_DIGEST = 'b'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest;

const storeOf = (chunks: Uint8Array[]) =>
  Layer.succeed(ArtifactStore, {
    open: () =>
      Effect.sync(
        () =>
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

const download = ({
  chunks,
  ...request
}: {
  chunks: Uint8Array[];
  artifact: DesiredArtifact;
  destination: string;
}) =>
  Effect.runPromiseExit(
    Effect.provide(downloadAndVerify(request), Layer.merge(storeOf(chunks), platform)),
  );

const failureTag = async (exit: Awaited<ReturnType<typeof download>>) =>
  exit._tag === 'Failure' ? String(exit.cause) : 'Success';

const digestOfFile = async (path: string) => {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
};

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
    const exit = await download({ chunks: [CONTENT], artifact: artifact(), destination });

    expect(exit._tag).toBe('Success');
    expect(await digestOfFile(destination)).toBe(CONTENT_DIGEST);
  });

  test('a mismatched digest fails and leaves nothing behind', async () => {
    const destination = join(directory, 'server');
    const exit = await download({
      chunks: [CONTENT],
      artifact: artifact({ digest: WRONG_DIGEST }),
      destination,
    });

    expect(await failureTag(exit)).toContain('DigestMismatch');
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test('bytes tampered with mid-stream are caught, not just a wrong first chunk', async () => {
    const tampered = new Uint8Array(CONTENT);
    tampered[tampered.length - 1] = 0;

    expect(
      await failureTag(
        await download({
          chunks: [tampered],
          artifact: artifact(),
          destination: join(directory, 'server'),
        }),
      ),
    ).toContain('DigestMismatch');
  });

  test('a size that disagrees with the manifest is rejected even when the digest matches', async () => {
    const destination = join(directory, 'server');
    const exit = await download({
      chunks: [CONTENT],
      artifact: artifact({ sizeBytes: CONTENT.byteLength + 1 }),
      destination,
    });

    expect(await failureTag(exit)).toContain('ArtifactSizeMismatch');
    expect(await Bun.file(destination).exists()).toBe(false);
  });

  test('a stream split across chunks hashes the same as one chunk', async () => {
    const destination = join(directory, 'server');
    const half = Math.floor(CONTENT.byteLength / 2);
    await download({
      chunks: [CONTENT.slice(0, half), CONTENT.slice(half)],
      artifact: artifact(),
      destination,
    });

    expect(await digestOfFile(destination)).toBe(CONTENT_DIGEST);
  });
});

test('the cache path depends only on the digest, so a redeploy of the same bytes is free', () => {
  const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

  expect(
    artifactImagePath({ cacheDir: '/var/lib/nibrun/artifacts', digest: CONTENT_DIGEST, path }),
  ).toBe(`/var/lib/nibrun/artifacts/${CONTENT_DIGEST}/artifact.squashfs`);
});

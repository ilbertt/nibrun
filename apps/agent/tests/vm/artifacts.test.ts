import { describe, expect, test } from 'bun:test';
import { Path } from '@effect/platform';
import { BunPath } from '@effect/platform-bun';
import type { DesiredArtifact, Sha256Digest } from '@repo/protocol';
import { Effect, Either } from 'effect';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST, artifactStore } from '#tests/support/artifacts.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';
import { artifactImagePath, downloadAndVerify } from '#vm/artifacts.ts';

const DIGEST_HEX_LENGTH = 64;
const WRONG_DIGEST = 'b'.repeat(DIGEST_HEX_LENGTH) as Sha256Digest;
const CACHE_DIR = '/var/lib/nibrun/artifacts';
const HALF = Math.floor(ARTIFACT_BYTES.byteLength / 2);
const SPLIT_CHUNKS = [ARTIFACT_BYTES.slice(0, HALF), ARTIFACT_BYTES.slice(HALF)];

const run = provided(platform);

async function digestOfFile(path: string) {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
}

/** Read inside the scope: the temp directory is gone by the time an assertion runs. */
function downloading({
  chunks = [ARTIFACT_BYTES],
  ...overrides
}: { chunks?: readonly Uint8Array[] } & Partial<DesiredArtifact> = {}) {
  return Effect.gen(function* () {
    const destination = `${yield* temporaryDirectory}/server`;
    const result = yield* Effect.either(
      Effect.provide(
        downloadAndVerify({ artifact: artifact(overrides), destination }),
        artifactStore(chunks),
      ),
    );
    const kept = yield* Effect.promise(() => Bun.file(destination).exists());
    if (!kept) {
      return { result, kept, writtenDigest: undefined };
    }
    return { result, kept, writtenDigest: yield* Effect.promise(() => digestOfFile(destination)) };
  });
}

describe('the digest is verified before anything can execute', () => {
  test('matching bytes are written and kept', async () => {
    const { result, writtenDigest } = await run(downloading());

    expect(Either.isRight(result)).toBe(true);
    expect(writtenDigest).toBe(ARTIFACT_DIGEST);
  });

  test('a mismatched digest fails and leaves nothing behind', async () => {
    const { result, kept } = await run(downloading({ digest: WRONG_DIGEST }));

    expect(Either.isLeft(result) && result.left._tag).toBe('DigestMismatch');
    expect(kept).toBe(false);
  });

  test('bytes tampered with mid-stream are caught, not just a wrong first chunk', async () => {
    const tampered = new Uint8Array(ARTIFACT_BYTES);
    tampered[tampered.length - 1] = 0;
    const { result } = await run(downloading({ chunks: [tampered] }));

    expect(Either.isLeft(result) && result.left._tag).toBe('DigestMismatch');
  });

  test('a size that disagrees with the manifest is rejected even when the digest matches', async () => {
    const { result, kept } = await run(downloading({ sizeBytes: ARTIFACT_BYTES.byteLength + 1 }));

    expect(Either.isLeft(result) && result.left._tag).toBe('ArtifactSizeMismatch');
    expect(kept).toBe(false);
  });

  test('a stream split across chunks hashes the same as one chunk', async () => {
    const { writtenDigest } = await run(downloading({ chunks: SPLIT_CHUNKS }));

    expect(writtenDigest).toBe(ARTIFACT_DIGEST);
  });
});

test('the cache path depends only on the digest, so a redeploy of the same bytes is free', () => {
  const path = Effect.runSync(Effect.provide(Path.Path, BunPath.layer));

  expect(artifactImagePath({ cacheDir: CACHE_DIR, digest: ARTIFACT_DIGEST, path })).toBe(
    `${CACHE_DIR}/${ARTIFACT_DIGEST}/artifact.squashfs`,
  );
});

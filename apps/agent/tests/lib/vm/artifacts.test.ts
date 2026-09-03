import { describe, expect, test } from 'bun:test';
import { FileSystem, Path } from '@effect/platform';
import { BunPath } from '@effect/platform-bun';
import { type DesiredArtifact, Sha256DigestSchema, Value } from '@repo/protocol';
import { Effect, Either, Layer } from 'effect';
import { artifactImagePath, downloadAndVerify, ensureArtifactImage } from '#lib/vm/artifacts.ts';
import { ARTIFACT_BYTES, ARTIFACT_DIGEST, artifactStore } from '#tests/support/artifacts.ts';
import { recordingCommands } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { artifact } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const DIGEST_HEX_LENGTH = 64;
const WRONG_DIGEST = Value.Parse(Sha256DigestSchema, 'b'.repeat(DIGEST_HEX_LENGTH));
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

/**
 * mksquashfs as it behaves when it fails: the output file exists by the time it gives up, which
 * is what used to be left in the cache. `command[2]` is the destination it was asked to write.
 */
const DESTINATION_ARGUMENT = 2;

function mksquashfsThat({ code }: { code: number }) {
  return recordingCommands((request) =>
    Effect.promise(async () => {
      await Bun.write(request.command[DESTINATION_ARGUMENT] ?? '', 'a squashfs image');
      return { code, stdout: '', stderr: '' };
    }),
  );
}

function buildingInto({ code }: { code: number }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const cacheDir = yield* temporaryDirectory;
    const result = yield* Effect.either(
      Effect.provide(
        ensureArtifactImage(artifact()),
        Layer.mergeAll(
          agentConfig({ artifactCacheDir: cacheDir }),
          artifactStore(),
          mksquashfsThat({ code }).layer,
        ),
      ),
    );
    return { result, entries: yield* fs.readDirectory(cacheDir) };
  });
}

const MKFS_FAILED = 1;
const MKFS_OK = 0;

describe('a build leaves the cache holding finished images and nothing else', () => {
  // Every way a build can end between mksquashfs and the rename used to leave the image behind,
  // and only a later build of the same digest ever cleared it.
  test('one that fails after writing its image leaves nothing at all', async () => {
    const { result, entries } = await run(buildingInto({ code: MKFS_FAILED }));

    expect(Either.isLeft(result)).toBe(true);
    expect(entries).toEqual([]);
  });

  test('one that succeeds leaves the image under its digest and no staging beside it', async () => {
    const { result, entries } = await run(buildingInto({ code: MKFS_OK }));

    expect(Either.isRight(result)).toBe(true);
    expect(entries).toEqual([ARTIFACT_DIGEST]);
  });
});

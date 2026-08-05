import type { Sha256Digest } from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { ArtifactStore } from '#services/artifact-store.service.ts';

export const ARTIFACT_BYTES = new TextEncoder().encode('#!/usr/bin/env fake-binary\n');
export const ARTIFACT_DIGEST = new Bun.CryptoHasher('sha256')
  .update(ARTIFACT_BYTES)
  .digest('hex') as Sha256Digest;

/** The artifact bucket as the chunks the transfer is meant to see, in the order it sees them. */
export function artifactStore(chunks: readonly Uint8Array[] = [ARTIFACT_BYTES]) {
  return Layer.succeed(
    ArtifactStore,
    ArtifactStore.make({
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
    }),
  );
}

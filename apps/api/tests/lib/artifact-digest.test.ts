import { describe, expect, test } from 'bun:test';
import { isValidMessage, ObjectKeySchema, Sha256DigestSchema, Value } from '@repo/protocol';
import { type ArtifactInspection, inspectArtifact } from '#lib/artifact-digest.ts';

// The api refuses anything that is not a Linux executable, so every fixture that is meant to be
// read to the end opens with the ELF magic the way a real upload does.
const BINARY = '\x7fELFnibrun-test-binary';
const OTHER_BINARY = '\x7fELFnibrun-other-binary';

const BINARY_DIGEST = Value.Parse(
  Sha256DigestSchema,
  'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298',
);

// Larger than anything here, so a test only meets the limit when it is the limit being tested.
const NO_LIMIT = 1024;

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/**
 * Counts what was pulled, because half of what this reads is how much it declines to read.
 *
 * Nothing is queued ahead of a read, so a chunk in `delivered` is one the inspection asked for
 * rather than one a buffer helped itself to.
 */
function streamOf(chunks: Uint8Array[]) {
  const delivered: Uint8Array[] = [];
  let index = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk === undefined) {
          controller.close();
          return;
        }
        delivered.push(chunk);
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, delivered };
}

function inspect({
  text,
  maxSizeBytes = NO_LIMIT,
}: {
  text: string;
  maxSizeBytes?: number;
}): Promise<ArtifactInspection> {
  return inspectArtifact({ stream: streamOf([bytesOf(text)]).stream, maxSizeBytes });
}

async function identityOf(text: string) {
  const inspection = await inspect({ text });
  if (inspection.outcome !== 'stored') {
    throw new Error(`expected ${text} to be storable, got ${inspection.outcome}`);
  }
  return inspection;
}

describe('an artifact is identified by what was stored, not by what was claimed', () => {
  test('the digest is the SHA-256 of the bytes', async () => {
    expect((await identityOf(BINARY)).digest).toBe(BINARY_DIGEST);
  });

  test('the size is the byte length', async () => {
    expect((await identityOf(BINARY)).sizeBytes).toBe(BINARY.length);
  });

  test('the same bytes always land on the same object key', async () => {
    expect((await identityOf(BINARY)).objectKey).toBe((await identityOf(BINARY)).objectKey);
  });

  test('bytes that differ anywhere land somewhere else', async () => {
    expect((await identityOf(BINARY)).objectKey).not.toBe(
      (await identityOf(OTHER_BINARY)).objectKey,
    );
  });

  test('the key names the digest, so a future algorithm cannot alias this object', async () => {
    expect((await identityOf(BINARY)).objectKey).toBe(Value.Parse(ObjectKeySchema, BINARY_DIGEST));
  });

  test('the identity satisfies the schemas the agent will read it back through', async () => {
    const { digest, objectKey } = await identityOf(BINARY);

    expect(isValidMessage({ schema: Sha256DigestSchema, value: digest })).toBe(true);
    expect(isValidMessage({ schema: ObjectKeySchema, value: objectKey })).toBe(true);
  });

  // The object arrives in whatever pieces the store sends it in, and none of them are the
  // boundaries of anything this reads: the magic alone can span two.
  test('where the chunks fall makes no difference to any of it', async () => {
    const split = streamOf([...bytesOf(BINARY)].map((byte) => Uint8Array.of(byte)));

    const inspection = await inspectArtifact({ stream: split.stream, maxSizeBytes: NO_LIMIT });

    expect(inspection).toEqual(await identityOf(BINARY));
  });
});

describe('what the guest could never exec is not read to the end', () => {
  test('an upload that is not a Linux executable is refused', async () => {
    expect(await inspect({ text: '#!/bin/sh' })).toEqual({ outcome: 'not-executable' });
  });

  // Nothing to compare against is not something to wave through: the loop reaches no verdict on
  // a stream this short, so the decision is the one made after it.
  test('an upload shorter than the magic is refused', async () => {
    expect(await inspect({ text: '\x7fEL' })).toEqual({ outcome: 'not-executable' });
  });

  test('the rest of it is never pulled', async () => {
    const chunks = [bytesOf('#!/bin/sh'), bytesOf('and a great deal more')];
    const { stream, delivered } = streamOf(chunks);

    await inspectArtifact({ stream, maxSizeBytes: NO_LIMIT });

    expect(delivered).toEqual([chunks[0] as Uint8Array]);
  });
});

describe('a size the store accepted is still a size this api will not', () => {
  // The store takes whatever it is handed, so a caller that declared one size and sent another
  // is caught here or not at all.
  test('an object past the limit is refused however large it turned out to be', async () => {
    expect(await inspect({ text: BINARY, maxSizeBytes: BINARY.length - 1 })).toEqual({
      outcome: 'too-large',
    });
  });

  test('one exactly at the limit is stored', async () => {
    expect((await inspect({ text: BINARY, maxSizeBytes: BINARY.length })).outcome).toBe('stored');
  });

  test('the rest of it is never pulled', async () => {
    const chunks = [bytesOf(BINARY), bytesOf('and a great deal more')];
    const { stream, delivered } = streamOf(chunks);

    await inspectArtifact({ stream, maxSizeBytes: BINARY.length - 1 });

    expect(delivered).toEqual([chunks[0] as Uint8Array]);
  });
});

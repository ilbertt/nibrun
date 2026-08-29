import { describe, expect, test } from 'bun:test';
import { isValidMessage, ObjectKeySchema, Sha256DigestSchema, Value } from '@repo/protocol';
import {
  type ArtifactInspection,
  ArtifactTooLargeError,
  boundedTo,
  inspectArtifact,
  inspectingPassThrough,
  RefusedArtifactError,
} from '#lib/artifact-digest.ts';

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

const ELF_HEADER_BYTES = 0x40;
const ELF_CLASS_AT = 4;
const ELF_CLASS_64 = 2;
const ELF_ENDIANNESS_AT = 5;
const ELF_LITTLE_ENDIAN = 1;
const SEGMENT_TABLE_START_AT = 0x20;
const SEGMENT_ENTRY_BYTES_AT = 0x36;
const SEGMENT_COUNT_AT = 0x38;
const SEGMENT_START_AT = 8;
const SEGMENT_BYTES_AT = 32;
const SEGMENT_ENTRY_BYTES = 56;
const SEGMENT_TYPE_INTERPRETER = 3;
const ONE_SEGMENT = 1;
const NO_SEGMENTS = 0;
const LITTLE_ENDIAN = true;

const GUEST_LOADER = '/lib64/ld-linux-x86-64.so.2';
const NIX_LOADER =
  '/nix/store/xx7cm72qy2c0643cm1ipngd87aqwkcdp-glibc-2.40-66/lib/ld-linux-x86-64.so.2';
const MUSL_LOADER = '/lib/ld-musl-x86_64.so.1';

/** Comfortably past the prefix the inspection holds, whatever that prefix is set to. */
const PAST_THE_HEADER_BYTES = 131_072;

/**
 * A 64-bit ELF whose only segment names a loader — or, given none, one that names no loader at
 * all, which is what a static binary looks like here.
 *
 * The layout is spelled out rather than taken from `#lib/elf.ts`, so that a test asserting how
 * an ELF is read cannot be satisfied by the reader agreeing with itself.
 */
function elfNaming(interpreter?: string): Uint8Array {
  const path = interpreter === undefined ? new Uint8Array() : bytesOf(`${interpreter}\0`);
  const pathStart = ELF_HEADER_BYTES + SEGMENT_ENTRY_BYTES;
  const bytes = new Uint8Array(pathStart + path.length);
  const view = new DataView(bytes.buffer);

  bytes.set(bytesOf('\x7fELF'));
  bytes[ELF_CLASS_AT] = ELF_CLASS_64;
  bytes[ELF_ENDIANNESS_AT] = ELF_LITTLE_ENDIAN;
  view.setBigUint64(SEGMENT_TABLE_START_AT, BigInt(ELF_HEADER_BYTES), LITTLE_ENDIAN);
  view.setUint16(SEGMENT_ENTRY_BYTES_AT, SEGMENT_ENTRY_BYTES, LITTLE_ENDIAN);
  view.setUint16(
    SEGMENT_COUNT_AT,
    interpreter === undefined ? NO_SEGMENTS : ONE_SEGMENT,
    LITTLE_ENDIAN,
  );
  view.setUint32(ELF_HEADER_BYTES, SEGMENT_TYPE_INTERPRETER, LITTLE_ENDIAN);
  view.setBigUint64(ELF_HEADER_BYTES + SEGMENT_START_AT, BigInt(pathStart), LITTLE_ENDIAN);
  view.setBigUint64(ELF_HEADER_BYTES + SEGMENT_BYTES_AT, BigInt(path.length), LITTLE_ENDIAN);
  bytes.set(path, pathStart);

  return bytes;
}

function inspectBytes(chunks: Uint8Array[]): Promise<ArtifactInspection> {
  return inspectArtifact({ stream: streamOf(chunks).stream, maxSizeBytes: PAST_THE_HEADER_BYTES });
}

describe('a loader the guest does not have is refused before a host ever sees it', () => {
  test('a binary built against a Nix toolchain is refused, naming the loader it asked for', async () => {
    expect(await inspectBytes([elfNaming(NIX_LOADER)])).toEqual({
      outcome: 'unsupported-interpreter',
      interpreter: NIX_LOADER,
    });
  });

  test('a binary built against musl is refused the same way', async () => {
    expect(await inspectBytes([elfNaming(MUSL_LOADER)])).toEqual({
      outcome: 'unsupported-interpreter',
      interpreter: MUSL_LOADER,
    });
  });

  test('the loader the image actually ships is stored', async () => {
    expect((await inspectBytes([elfNaming(GUEST_LOADER)])).outcome).toBe('stored');
  });

  // The guest execs it directly, so naming no loader is the one case that needs nothing from
  // the image at all.
  test('a static binary names no loader and is stored', async () => {
    expect((await inspectBytes([elfNaming()])).outcome).toBe('stored');
  });

  // Refusing on a path that was never read would reject binaries that are fine, so anything
  // this cannot parse has to pass.
  test('an ELF whose headers this cannot read is stored rather than guessed at', async () => {
    expect((await inspect({ text: BINARY })).outcome).toBe('stored');
  });

  test('where the chunks fall makes no difference to the verdict', async () => {
    const split = [...elfNaming(NIX_LOADER)].map((byte) => Uint8Array.of(byte));

    expect(await inspectBytes(split)).toEqual({
      outcome: 'unsupported-interpreter',
      interpreter: NIX_LOADER,
    });
  });

  // Longer than the prefix, so the verdict is reached partway through the first chunk rather
  // than at the end of an object that may be hundreds of megabytes.
  test('the rest of it is never pulled', async () => {
    const head = new Uint8Array(PAST_THE_HEADER_BYTES);
    head.set(elfNaming(NIX_LOADER));
    const chunks = [head, bytesOf('and a great deal more')];
    const { stream, delivered } = streamOf(chunks);

    await inspectArtifact({ stream, maxSizeBytes: PAST_THE_HEADER_BYTES });

    expect(delivered).toEqual([chunks[0] as Uint8Array]);
  });
});

/**
 * The inspection made of bytes on their way into the store, which is how a fetched binary is read:
 * once, with one chunk in hand. What it refuses it refuses into the stream, so the upload carrying
 * those bytes stops where it is rather than finishing something nobody will deploy.
 */
describe('bytes are inspected on their way past', () => {
  function streamed(chunks: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(bytesOf(chunk));
        }
        controller.close();
      },
    });
  }

  async function written(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: number[] = [];
    for await (const chunk of stream) {
      chunks.push(...chunk);
    }
    return Uint8Array.from(chunks);
  }

  test('what comes out is what went in, and the verdict is the same as reading it whole', async () => {
    const { through, inspection } = inspectingPassThrough({ maxSizeBytes: NO_LIMIT });

    const bytes = await written(streamed([BINARY]).pipeThrough(through));

    expect(bytes).toEqual(bytesOf(BINARY));
    expect(await inspection).toEqual(
      await inspectArtifact({ stream: streamed([BINARY]), maxSizeBytes: NO_LIMIT }),
    );
  });

  test('a refusal stops whoever is writing, and says what it was', async () => {
    const { through } = inspectingPassThrough({ maxSizeBytes: NO_LIMIT });

    const refused = written(streamed(['not an executable']).pipeThrough(through));

    await expect(refused).rejects.toBeInstanceOf(RefusedArtifactError);
    await expect(refused).rejects.toMatchObject({
      inspection: { outcome: 'not-executable' },
    });
  });

  // A cap on what is stored rather than on what was sent: the two are the same bytes here, and
  // `boundedTo` below is the one that holds a source to a length before they are read at all.
  test('a stream past what could be stored is cut off rather than finished', async () => {
    const { through } = inspectingPassThrough({ maxSizeBytes: BINARY.length });

    const refused = written(streamed([BINARY, OTHER_BINARY]).pipeThrough(through));

    await expect(refused).rejects.toMatchObject({ inspection: { outcome: 'too-large' } });
  });
});

/**
 * What is read from a url, bounded before anything downstream sees it: an upload is signed for the
 * size it declared, and a url is followed on nothing more than what its host chose to say.
 */
describe('a source is read as far as what may be stored and no further', () => {
  test('bytes under the bound pass through unchanged', async () => {
    const bounded = sending([BINARY]).pipeThrough(boundedTo({ maxSizeBytes: NO_LIMIT }));

    expect(await readWhole(bounded)).toEqual(bytesOf(BINARY));
  });

  test('a source that keeps sending is stopped rather than read to its end', async () => {
    const bounded = sending([BINARY, OTHER_BINARY]).pipeThrough(
      boundedTo({ maxSizeBytes: BINARY.length }),
    );

    await expect(readWhole(bounded)).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });

  // Counted across chunks rather than per chunk: a source sending the cap twice in two halves is
  // sending twice the cap.
  test('and is stopped at the byte the bound was reached on', async () => {
    const halved = BINARY.slice(0, Math.floor(BINARY.length / 2));
    const bounded = sending([halved, halved]).pipeThrough(
      boundedTo({ maxSizeBytes: halved.length }),
    );

    await expect(readWhole(bounded)).rejects.toBeInstanceOf(ArtifactTooLargeError);
  });
});

function sending(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(bytesOf(chunk));
      }
      controller.close();
    },
  });
}

async function readWhole(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: number[] = [];
  for await (const chunk of stream) {
    chunks.push(...chunk);
  }
  return Uint8Array.from(chunks);
}

import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { UnreadableArchiveError, unwrapExecutable } from '#lib/zip.ts';
import { archiveOf, LOCAL_HEADER_BYTES } from '#tests/support/archives.ts';

const NOTE_LINES = 8;

// What the api will store, and the only thing a walk of an archive is looking for.
const BINARY = bytesOf('\x7fELFnibrun-test-binary');
const NOTES = bytesOf('# Changelog\n\nEverything, all at once.\n'.repeat(NOTE_LINES));
const LICENCE = bytesOf('The MIT Licence, as every release archive carries it.\n');

// Larger than any fixture here, so a walk only stops early when stopping early is the test.
const NO_LIMIT = 1_048_576;

/**
 * Small enough to fall inside a header, a name and the window a descriptor is looked for in, so
 * every fixture is read across chunk boundaries rather than out of one buffer.
 */
const CHUNK_BYTES = 7;

/** The crc and the two sizes a descriptor carries after its signature. */
const DESCRIPTOR_FIELD_BYTES = 12;

/** Into an entry's data, and no further: enough that the walk has started reading it. */
const A_FEW_BYTES_IN = 4;

/** Enough of a stored entry for the magic at the front of it to have been handed on. */
const PAST_THE_MAGIC = 8;

/** Shorter than the notes a release archive opens with, so the walk gives up inside them. */
const A_SHORT_WALK = 8;

describe('a zip is walked to the executable inside it', () => {
  test('past the notes and the licence a release ships beside the binary', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'LICENSE.md', content: LICENCE },
      { name: 'pocketbase', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    if (unwrapped.outcome !== 'unwrapped') {
      return;
    }
    expect(unwrapped.name).toBe('pocketbase');
    expect(await collected(unwrapped.body)).toEqual(BINARY);
  });

  test('where the headers declare their own sizes rather than trailing them', async () => {
    const archive = archiveOf([
      { name: 'README.md', content: NOTES, sizesInDescriptor: false },
      { name: 'my-server', content: BINARY, sizesInDescriptor: false },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  test('where the entry was never compressed at all', async () => {
    const archive = archiveOf([{ name: 'my-server', content: BINARY, stored: true }]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  test('under the name the entry has, not the directory it was kept in', async () => {
    const archive = archiveOf([{ name: 'dist/linux-amd64/my-server', content: BINARY }]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome === 'unwrapped' && unwrapped.name).toBe('my-server');
  });

  /**
   * The end of an entry is a descriptor that agrees on how far it sits from the start, so a run of
   * bytes that only spells the signature is data like any other — and this fixture stores rather
   * than compresses, which is the one way to put those bytes in an entry on purpose.
   */
  test('past compressed bytes that spell a descriptor of their own', async () => {
    const impostor = Buffer.concat([
      bytesOf('leading'),
      Buffer.from('PK\x07\x08', 'latin1'),
      Buffer.alloc(DESCRIPTOR_FIELD_BYTES),
      bytesOf('trailing'),
    ]);
    const archive = archiveOf([
      { name: 'notes.bin', content: impostor, stored: true },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });
});

describe('a zip that holds no executable is not one to fetch from', () => {
  test('an archive of documents alone', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'LICENSE.md', content: LICENCE },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('no-executable');
  });

  test('an archive that stops before the entry it was walking past ends', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(
        archive.subarray(0, LOCAL_HEADER_BYTES + 'CHANGELOG.md'.length + A_FEW_BYTES_IN),
      ),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unreadable');
  });

  // Found by whoever is storing the bytes rather than here: the entry was named and its first
  // bytes read before anything could say the rest of it would not arrive.
  test('an archive that stops in the middle of the executable', async () => {
    const archive = archiveOf([
      { name: 'my-server', content: BINARY, stored: true, sizesInDescriptor: false },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(
        archive.subarray(0, LOCAL_HEADER_BYTES + 'my-server'.length + PAST_THE_MAGIC),
      ),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    if (unwrapped.outcome !== 'unwrapped') {
      return;
    }
    await expect(collected(unwrapped.body)).rejects.toBeInstanceOf(UnreadableArchiveError);
  });

  test('an archive that would have to be read past what will be walked', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: A_SHORT_WALK,
    });

    expect(unwrapped.outcome).toBe('walked-too-far');
  });
});

describe('bytes that are not an archive are the binary themselves', () => {
  test('handed back with the bytes that were read to tell', async () => {
    const unwrapped = await unwrapExecutable({
      archive: streamOf(BINARY),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('not-an-archive');
    expect(unwrapped.outcome === 'not-an-archive' && (await collected(unwrapped.body))).toEqual(
      BINARY,
    );
  });

  test('including bytes too short to say what they are', async () => {
    const unwrapped = await unwrapExecutable({
      archive: streamOf(bytesOf('PK')),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('not-an-archive');
  });
});

function bytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, at + CHUNK_BYTES));
      at += CHUNK_BYTES;
    },
  });
}

async function collected(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

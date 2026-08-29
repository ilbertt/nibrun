import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { unwrapExecutable } from '#lib/archive/unwrap.ts';
import { MAX_ENTRIES, UnreadableArchiveError } from '#lib/archive/walk.ts';
import { BLOCK_BYTES, gzippedTarballOf, type TarballEntry } from '#tests/support/tarballs.ts';

const NOTE_LINES = 8;

// What the api will store, and the only thing a walk of an archive is looking for.
const BINARY = bytesOf('\x7fELFnibrun-test-binary');
const NOTES = bytesOf('# Changelog\n\nEverything, all at once.\n'.repeat(NOTE_LINES));
const LICENCE = bytesOf('The MIT Licence, as every release archive carries it.\n');
const NOTHING = new Uint8Array(0);

const NO_LIMIT = 1_048_576;

/** Small enough to fall inside a header, so every fixture is read across chunk boundaries. */
const CHUNK_BYTES = 7;

/** Shorter than the notes a release archive opens with, so the walk gives up inside them. */
const A_SHORT_WALK = 8;

/** One past what a walk will read the headers of. */
const PAST_THE_ENTRY_LIMIT = MAX_ENTRIES + 1;

const TYPE_DIRECTORY = '5';
const TYPE_SYMLINK = '2';

describe('a tarball is walked to the executable inside it', () => {
  test('past the notes and the licence a release ships beside the binary', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'CHANGELOG.md', content: NOTES },
        { name: 'LICENSE.md', content: LICENCE },
        { name: 'my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    if (unwrapped.outcome !== 'unwrapped') {
      return;
    }
    expect(unwrapped.name).toBe('my-server');
    expect(await collected(unwrapped.body)).toEqual(BINARY);
  });

  // Every entry is padded out to a whole block, so a walk that counted only the length it was told
  // would start reading the next header partway through the padding of the last one.
  test('past an entry whose length is not a whole number of blocks', async () => {
    const odd = bytesOf('x'.repeat(BLOCK_BYTES + 1));

    const unwrapped = await walk({
      entries: [
        { name: 'CHANGELOG.md', content: odd },
        { name: 'my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  test('under the name the entry has, not the directory it was kept in', async () => {
    const unwrapped = await walk({
      entries: [{ name: 'dist/linux-amd64/my-server', content: BINARY }],
    });

    expect(unwrapped.outcome === 'unwrapped' && unwrapped.name).toBe('my-server');
  });

  // `tar czf` of a directory writes an entry for the directory itself before the files in it.
  test('past the directory entries a recursive tar writes', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'dist/', content: NOTHING, type: TYPE_DIRECTORY },
        { name: 'dist/linux-amd64/', content: NOTHING, type: TYPE_DIRECTORY },
        { name: 'dist/linux-amd64/my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  test('where the entry says it is a file with a NUL rather than a digit', async () => {
    const unwrapped = await walk({
      entries: [{ name: 'my-server', content: BINARY, typeUnset: true }],
    });

    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });
});

describe('a tarball that holds no executable is not one to fetch from', () => {
  test('an archive of documents alone', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'CHANGELOG.md', content: NOTES },
        { name: 'LICENSE.md', content: LICENCE },
      ],
    });

    expect(unwrapped.outcome).toBe('no-executable');
  });

  // A symlink's target is its header, not its data, so what it points at is nothing a walk holds.
  test('an archive whose only executable is something a link points at', async () => {
    const unwrapped = await walk({
      entries: [{ name: 'my-server', content: NOTHING, type: TYPE_SYMLINK }],
    });

    expect(unwrapped.outcome).toBe('no-executable');
  });

  test('an archive that stops in the middle of the entry it was walking past', async () => {
    const whole = gzippedTarballOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(whole.subarray(0, whole.byteLength / 2)),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unreadable');
  });

  test('an archive that would have to be read past what will be walked', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'CHANGELOG.md', content: NOTES },
        { name: 'my-server', content: BINARY },
      ],
      maxSkippedBytes: A_SHORT_WALK,
    });

    expect(unwrapped.outcome).toBe('walked-too-far');
  });

  test('an archive of more entries than a walk will read the headers of', async () => {
    const unwrapped = await walk({
      entries: Array.from(Array(PAST_THE_ENTRY_LIMIT).keys(), entryOfNothing),
    });

    expect(unwrapped.outcome).toBe('walked-too-far');
  });

  // Eleven octal digits stop at eight gibibytes; past that the field is base 256 and says a length
  // there is no storing and no walking past.
  test('an archive whose entry declares a length in base 256', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'huge.bin', content: NOTES, sizeInBase256: true },
        { name: 'my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome).toBe('entry-too-large');
  });
});

describe('a gzip that is not a tarball is the binary itself', () => {
  // A release published as a bare `my-server.gz` is a gunzip away from being deployable, and
  // whether what comes out is an executable is a question the inspection asks of everything.
  test('handed on as the bytes it holds', async () => {
    const unwrapped = await unwrapExecutable({
      archive: streamOf(gzipSync(BINARY)),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('not-an-archive');
    expect(unwrapped.outcome === 'not-an-archive' && (await collected(unwrapped.body))).toEqual(
      BINARY,
    );
  });

  test('including a gzip too short to hold a tar header at all', async () => {
    const unwrapped = await unwrapExecutable({
      archive: streamOf(gzipSync(bytesOf('no'))),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('not-an-archive');
  });

  // Found by whoever is storing the bytes rather than here: nothing about the opening of a gzip
  // says whether the rest of it will arrive.
  test('and a gzip that stops part way fails inside the bytes it handed on', async () => {
    const whole = gzipSync(NOTES);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(whole.subarray(0, whole.byteLength - 1)),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('not-an-archive');
    if (unwrapped.outcome !== 'not-an-archive') {
      return;
    }
    await expect(collected(unwrapped.body)).rejects.toBeInstanceOf(UnreadableArchiveError);
  });
});

function walk({
  entries,
  maxSkippedBytes = NO_LIMIT,
}: {
  entries: TarballEntry[];
  maxSkippedBytes?: number;
}) {
  return unwrapExecutable({ archive: streamOf(gzippedTarballOf(entries)), maxSkippedBytes });
}

function entryOfNothing(index: number): TarballEntry {
  return { name: `note-${index}`, content: NOTHING };
}

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

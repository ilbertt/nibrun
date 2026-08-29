import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { unwrapExecutable } from '#lib/archive/unwrap.ts';
import { UnreadableArchiveError } from '#lib/archive/walk.ts';
import {
  A_SHORT_WALK,
  BINARY,
  bytesOf,
  CHUNK_BYTES,
  collected,
  LICENCE,
  NO_LIMIT,
  NOTES,
  NOTHING,
  PAST_THE_ENTRY_LIMIT,
  sourceOf,
  streamOf,
} from '#tests/lib/archive/support/fixtures.ts';
import { type ArchiveEntry, archiveOf, LOCAL_HEADER_BYTES } from '#tests/support/archives.ts';

/** The crc and the two sizes a descriptor carries after its signature. */
const DESCRIPTOR_FIELD_BYTES = 12;

/** Into an entry's data, and no further: enough that the walk has started reading it. */
const A_FEW_BYTES_IN = 4;

/** Enough of a stored entry for the magic at the front of it to have been handed on. */
const PAST_THE_MAGIC = 8;

/** More entries than a budget counting only what they hold would ever stop a walk through. */
const MANY_ENTRIES = 64;

/** Room for a header or two, and nothing like room for all of them. */
const A_FEW_HEADERS = 100;

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

  // The signature was never part of the format, only a convention writers settled on, so an entry
  // ends where a descriptor agrees it does whether or not one is there to find.
  test('past an entry whose descriptor was written without a signature', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES, descriptor: { signed: false } },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  // An entry that declared zip64 writes both its sizes eight bytes wide, so its descriptor is
  // eight bytes longer than the one every other entry carries.
  test('past an entry that declared its sizes zip64-wide', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES, descriptor: { zip64: true } },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  // A source is entitled to hand on a chunk with nothing in it, and that is not the source ending.
  test('where the source hands on a chunk with nothing in it', async () => {
    const archive = archiveOf([
      { name: 'my-server', content: BINARY, stored: true, sizesInDescriptor: false },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: haltingStreamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
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

  // Entries that declare nothing cost nothing to skip, so a budget counting only what was skipped
  // is no bound at all on an archive that is headers the whole way down.
  test('an archive of headers alone, which holds no data for a budget to count', async () => {
    const archive = archiveOf(Array.from(Array(MANY_ENTRIES).keys(), entryOfNothing));

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: A_FEW_HEADERS,
    });

    expect(unwrapped.outcome).toBe('walked-too-far');
  });

  // The walk stops with the rest of the archive still on its way, and a source nobody is reading
  // holds its connection open until it is let go of.
  test('and the source it stopped part way through is let go of', async () => {
    const archive = archiveOf([
      { name: 'CHANGELOG.md', content: NOTES },
      { name: 'my-server', content: BINARY },
    ]);
    const source = sourceOf({ bytes: archive });

    await unwrapExecutable({ archive: source.stream, maxSkippedBytes: A_SHORT_WALK });

    expect(source.wasLetGo()).toBe(true);
  });

  // Some writers reach for zip64 whatever the lengths are, so an entry whose real ones are beside
  // the header is an ordinary entry to walk past rather than an archive to refuse.
  test('past an entry that kept its lengths in a zip64 field beside the header', async () => {
    const archive = archiveOf([
      {
        name: 'CHANGELOG.md',
        content: NOTES,
        sizesInDescriptor: false,
        zip64Sizes: 'in-the-extra-field',
      },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  // The header points at a field the archive never wrote, so the length is one nothing can know.
  test('an archive whose entry declares a length it then says nowhere', async () => {
    const archive = archiveOf([
      { name: 'huge.bin', content: NOTES, sizesInDescriptor: false, zip64Sizes: 'said-nowhere' },
      { name: 'my-server', content: BINARY },
    ]);

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('entry-too-large');
  });

  // The headers themselves are the work, and a budget in bytes is no bound on how many of them an
  // archive small enough to fetch can carry.
  test('an archive of more entries than a walk will read the headers of', async () => {
    const archive = archiveOf(Array.from(Array(PAST_THE_ENTRY_LIMIT).keys(), entryOfNothing));

    const unwrapped = await unwrapExecutable({
      archive: streamOf(archive),
      maxSkippedBytes: NO_LIMIT,
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

/** An entry that declares no data at all, which is the whole of what it costs to walk past. */
function entryOfNothing(index: number): ArchiveEntry {
  return { name: `note-${index}`, content: NOTHING, stored: true, sizesInDescriptor: false };
}

/** The same archive, with a chunk of nothing handed on between every chunk that holds something. */
function haltingStreamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let at = 0;
  let holding = true;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      holding = !holding;
      if (holding) {
        controller.enqueue(bytes.subarray(at, at + CHUNK_BYTES));
        at += CHUNK_BYTES;
        return;
      }
      controller.enqueue(NOTHING);
    },
  });
}

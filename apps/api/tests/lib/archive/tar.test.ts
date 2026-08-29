import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { unwrapExecutable } from '#lib/archive/unwrap.ts';
import { UnreadableArchiveError } from '#lib/archive/walk.ts';
import {
  A_SHORT_WALK,
  BINARY,
  bytesOf,
  collected,
  LICENCE,
  NO_LIMIT,
  NOTES,
  NOTHING,
  PAST_THE_ENTRY_LIMIT,
  sourceOf,
  streamOf,
} from '#tests/lib/archive/support/fixtures.ts';
import { incompressible } from '#tests/support/downloads.ts';
import {
  BLOCK_BYTES,
  gzippedTarballOf,
  type TarballEntry,
  tarballOf,
} from '#tests/support/tarballs.ts';

const TYPE_DIRECTORY = '5';
const TYPE_SYMLINK = '2';

/** What gnu tar writes a path too long for a header as, in front of the entry it names. */
const TYPE_LONG_NAME = 'L';
const LONG_NAME_ENTRY = '././@LongLink';

/** As much of the path as the header that follows a long-name entry keeps. */
const NAME_FIELD_BYTES = 100;

/** Longer than that, which is the whole reason gnu tar writes the path out on its own. */
const A_LONG_PATH =
  'dist/a-long-release-directory-segment/another-segment-of-similar-length/and-one-more-for-good-measure/my-server';

/**
 * More than a gunzip reads ahead of what it has been asked for, so a walk that gives up early
 * leaves the rest of the source still on its way rather than already arrived.
 */
const A_LONG_DOWNLOAD = 524_288;
const A_TRANSFER_CHUNK = 65_536;

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

  /**
   * Gnu is what `tar czf` writes by default on linux, which is where release tarballs come from.
   * The header after a long-name entry keeps the first hundred bytes of the path, and those are
   * the leading directories — so a walk reading the header alone names the binary after a piece
   * of the folder it sits in.
   */
  test('under the path a gnu long-name entry carries rather than the truncated header', async () => {
    expect(A_LONG_PATH.length).toBeGreaterThan(NAME_FIELD_BYTES);

    const unwrapped = await walk({ entries: longNamed({ path: A_LONG_PATH, content: BINARY }) });

    expect(unwrapped.outcome).toBe('unwrapped');
    if (unwrapped.outcome !== 'unwrapped') {
      return;
    }
    expect(unwrapped.name).toBe('my-server');
    expect(await collected(unwrapped.body)).toEqual(BINARY);
  });

  // The path is read into memory where every other entry is walked past a chunk at a time, so an
  // entry claiming more than a path could be is skipped like any other rather than held.
  test('past a long-name entry claiming more than a path could be', async () => {
    const unwrapped = await walk({
      entries: [
        { name: LONG_NAME_ENTRY, content: NOTES, type: TYPE_LONG_NAME },
        { name: 'my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome === 'unwrapped' && (await collected(unwrapped.body))).toEqual(BINARY);
  });

  // A tar says what it is a quarter of a kibibyte in rather than in its first bytes, so nothing
  // about the opening of an uncompressed one distinguishes it from a binary until that far.
  test('where the tarball was published without being compressed at all', async () => {
    const unwrapped = await unwrapExecutable({
      archive: streamOf(
        tarballOf([
          { name: 'CHANGELOG.md', content: NOTES },
          { name: 'my-server', content: BINARY },
        ]),
      ),
      maxSkippedBytes: NO_LIMIT,
    });

    expect(unwrapped.outcome).toBe('unwrapped');
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
      archive: streamOf(whole.subarray(0, Math.floor(whole.byteLength / 2))),
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

  // A length is octal text read as a whole. Taking the digits a corrupt field opens with and
  // stopping at the first byte that is not one would put the walk a few bytes out of step with the
  // headers, and everything after that is read out of the middle of something.
  test('an archive whose entry declares a length that is not octal at all', async () => {
    const unwrapped = await walk({
      entries: [
        { name: 'CHANGELOG.md', content: NOTES, sizeText: '00000000012x' },
        { name: 'my-server', content: BINARY },
      ],
    });

    expect(unwrapped.outcome).toBe('unreadable');
  });

  /**
   * The walk stops with the rest of the archive still on its way, and a source nobody is reading
   * holds its connection open until it is let go of. Through the gunzip as much as around it: a
   * pipe carries being given up on no further than the engine it feeds.
   */
  test('and the source it stopped part way through is let go of', async () => {
    const source = sourceOf({
      bytes: gzippedTarballOf([
        { name: 'CHANGELOG.md', content: incompressible(A_LONG_DOWNLOAD) },
        { name: 'my-server', content: BINARY },
      ]),
      chunkBytes: A_TRANSFER_CHUNK,
    });

    const unwrapped = await unwrapExecutable({
      archive: source.stream,
      maxSkippedBytes: A_SHORT_WALK,
    });

    expect(unwrapped.outcome).toBe('walked-too-far');
    expect(source.wasLetGo()).toBe(true);
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

/** The pair gnu tar writes for a path a header cannot hold: the path, then the entry it belongs to. */
function longNamed({ path, content }: { path: string; content: Uint8Array }): TarballEntry[] {
  return [
    { name: LONG_NAME_ENTRY, content: bytesOf(`${path}\0`), type: TYPE_LONG_NAME },
    { name: path.slice(0, NAME_FIELD_BYTES), content },
  ];
}

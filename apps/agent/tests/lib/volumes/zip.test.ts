import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchiveEntry } from '#lib/volumes/archive.ts';
import { UnreadableArchive } from '#lib/volumes/archive.ts';
import { zipEntries } from '#lib/volumes/zip.ts';
import {
  FLAG_ENCRYPTED,
  METHOD_BZIP2,
  METHOD_STORED,
  UNIX_DIRECTORY,
  UNIX_FIFO,
  UNIX_SYMLINK,
  type ZipEntry,
  zipOf,
} from '#tests/support/zip.ts';

const PRIVATE_FILE_MODE = 0o640;
const PRIVATE_DIRECTORY_MODE = 0o750;
const RUNNABLE_MODE = 0o755;
/** What an entry is given where the archive carries no mode to preserve. */
const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIRECTORY_MODE = 0o755;
const LINK_MODE = 0o777;
/** Longer than the bound a target is read to, which is what stops one being read into memory. */
const OVERSIZED_TARGET_BYTES = 5000;
/** More than one read of the stream the entry is inflated through. */
const SPANNING_BODY_REPEATS = 60_000;
const ROWS_BYTES = 4;
/** A magic and nothing behind it, which is a file that opens like a zip and is not one. */
const ZIP_MAGIC_ALONE = Buffer.from('PK\x03\x04', 'latin1');
/** An id no extra field is registered under, so the walk over them finds no zip64 one. */
const UNKNOWN_EXTRA_ID = Buffer.from('\xff\xff', 'latin1');
/** Where the records a test reaches into sit, counted back from the end of the archive. */
const DIRECTORY_END_BYTES = 22;
const END_DIRECTORY_BYTES_AT = 12;
const ZIP64_SIZES_FIELD_BYTES = 20;
/** Past the bound the index is held to, and short of the sentinel that would mean zip64. */
const ABSURD_INDEX = 0xff_ff_ff_00;

type ReadEntry = Pick<ArchiveEntry, 'path' | 'kind' | 'mode' | 'sizeBytes' | 'linkTarget'> & {
  body: string;
};

const made: string[] = [];

async function fileOf(bytes: Uint8Array): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'nib-zip-'));
  made.push(directory);
  const path = join(directory, 'archive.zip');
  await Bun.write(path, bytes);
  return path;
}

async function entriesOf(bytes: Uint8Array): Promise<ReadEntry[]> {
  const read: ReadEntry[] = [];
  for await (const entry of zipEntries(await fileOf(bytes))) {
    const pieces: Uint8Array[] = [];
    for await (const piece of entry.content()) {
      pieces.push(piece);
    }
    read.push({
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      sizeBytes: entry.sizeBytes,
      linkTarget: entry.linkTarget,
      body: new TextDecoder().decode(Buffer.concat(pieces.map((piece) => Buffer.from(piece)))),
    });
  }
  return read;
}

function reading(entries: readonly ZipEntry[]): Promise<ReadEntry[]> {
  return entriesOf(zipOf({ entries }));
}

describe('an entry is read as what the index says it is', () => {
  test('a file carries its path, its length and the bytes it holds', async () => {
    const [entry] = await reading([
      { path: 'pb_data/data.db', mode: PRIVATE_FILE_MODE, body: 'rows' },
    ]);

    expect(entry).toEqual({
      path: 'pb_data/data.db',
      kind: 'file',
      mode: PRIVATE_FILE_MODE,
      sizeBytes: 4,
      linkTarget: '',
      body: 'rows',
    });
  });

  test('an entry stored rather than compressed is read as it lies', async () => {
    const [entry] = await reading([{ path: 'notes.txt', body: 'hello', method: METHOD_STORED }]);

    expect(entry?.body).toBe('hello');
  });

  /** Bigger than one read, so what comes back is assembled rather than taken in hand. */
  test('an entry longer than a chunk arrives whole', async () => {
    const body = 'rows,'.repeat(SPANNING_BODY_REPEATS);
    const [entry] = await reading([{ path: 'big.csv', body }]);

    expect(entry?.body).toBe(body);
    expect(entry?.sizeBytes).toBe(body.length);
  });

  test('a directory is one by its mode, and by its name where there is no mode', async () => {
    const read = await reading([
      { path: 'pb_data/', unixType: UNIX_DIRECTORY, mode: PRIVATE_DIRECTORY_MODE },
      { path: 'uploads/', dos: true },
    ]);

    expect(read.map((entry) => [entry.kind, entry.mode])).toEqual([
      ['directory', PRIVATE_DIRECTORY_MODE],
      ['directory', DEFAULT_DIRECTORY_MODE],
    ]);
  });

  test('a symlink says where it points, which a zip writes as the entry itself', async () => {
    const [entry] = await reading([
      {
        path: 'latest',
        unixType: UNIX_SYMLINK,
        mode: LINK_MODE,
        body: 'pb_data/data.db',
        method: METHOD_STORED,
      },
    ]);

    expect(entry?.kind).toBe('symlink');
    expect(entry?.linkTarget).toBe('pb_data/data.db');
  });

  test('anything that is not one of the three is left for the unpack to refuse', async () => {
    const [entry] = await reading([{ path: 'pipe', unixType: UNIX_FIFO }]);

    expect(entry?.kind).toBe('unsupported');
  });
});

/**
 * The mode is in `external file attributes`, which only holds one when the archive was made on
 * unix — the same four bytes are dos attribute bits everywhere else. So this is what a zip made by
 * Finder, Windows or a browser comes to, which is most of the zips an owner will upload.
 */
describe('a zip made anywhere but unix carries no permissions to preserve', () => {
  test('a file is given the mode a freshly written one would have', async () => {
    const [entry] = await reading([{ path: 'data.db', dos: true, body: 'rows' }]);

    expect(entry?.mode).toBe(DEFAULT_FILE_MODE);
    expect(entry?.kind).toBe('file');
  });

  // Some writers say unix and fill in nothing, which tells the reader exactly as much.
  test('unix in one field and nothing in the other is the same as saying nothing', async () => {
    const read = await reading([
      { path: 'data.db', mode: PRIVATE_FILE_MODE, noAttributes: true, body: 'rows' },
      { path: 'pb_data/', unixType: UNIX_DIRECTORY, noAttributes: true },
    ]);

    expect(read.map((entry) => [entry.kind, entry.mode])).toEqual([
      ['file', DEFAULT_FILE_MODE],
      ['directory', DEFAULT_DIRECTORY_MODE],
    ]);
  });

  test('an executable bit cannot survive one, and is not invented', async () => {
    const [entry] = await reading([{ path: 'helper', dos: true, body: '#!/bin/sh' }]);

    expect(entry?.mode).not.toBe(RUNNABLE_MODE);
  });
});

/**
 * The index is in whatever order the writer chose, and the unpack judges a symlink as it passes
 * one — so an entry arriving before the link above it would be written through a link nobody had
 * judged.
 */
test('entries arrive in an order that never puts one before what contains it', async () => {
  const read = await reading([
    { path: 'a/b/c.txt', body: 'deep' },
    { path: 'a/', unixType: UNIX_DIRECTORY },
    { path: 'a/b/', unixType: UNIX_DIRECTORY },
  ]);

  expect(read.map((entry) => entry.path)).toEqual(['a/', 'a/b/', 'a/b/c.txt']);
});

describe('an archive this will not follow', () => {
  test('one that names the same path twice', async () => {
    const bytes = zipOf({
      entries: [
        { path: 'data.db', body: 'what a reader sees' },
        { path: 'data.db', body: 'what an extractor keeps' },
      ],
    });

    await expect(entriesOf(bytes)).rejects.toBeInstanceOf(UnreadableArchive);
    await expect(entriesOf(bytes)).rejects.toThrow('names the same path twice');
  });

  test('one holding an entry behind a password', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows', flags: FLAG_ENCRYPTED }] });

    await expect(entriesOf(bytes)).rejects.toThrow('behind a password');
  });

  test('one compressed in a way nibrun does not undo', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows', method: METHOD_BZIP2 }] });

    await expect(entriesOf(bytes)).rejects.toThrow('compressed in a way');
  });

  test('one whose entry holds less than the index said', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows', declaredSize: 4096 }] });

    await expect(entriesOf(bytes)).rejects.toThrow('shorter than it said it was');
  });

  test('one whose index points where no entry begins', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows' }] });
    bytes.set([0, 0, 0, 0], 0);

    await expect(entriesOf(bytes)).rejects.toThrow('pointing where no entry begins');
  });

  test('one with no index at the end of it at all', async () => {
    await expect(entriesOf(new Uint8Array(ZIP_MAGIC_ALONE))).rejects.toThrow(
      'does not end with the index',
    );
  });

  /**
   * The index is read whole, so its declared size is the one allocation an archive chooses. This
   * one claims an index far past what any archive the unpack would accept could need.
   */
  test('one claiming an index too large to hold', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows' }] });
    const view = new DataView(bytes.buffer);
    view.setUint32(bytes.length - DIRECTORY_END_BYTES + END_DIRECTORY_BYTES_AT, ABSURD_INDEX, true);

    await expect(entriesOf(bytes)).rejects.toThrow('index larger than one an app');
  });

  /** A target is a path. One larger than any filesystem takes is an entry read into memory. */
  test('one whose symlink points somewhere absurd', async () => {
    const bytes = zipOf({
      entries: [
        {
          path: 'latest',
          unixType: UNIX_SYMLINK,
          mode: LINK_MODE,
          body: 'x'.repeat(OVERSIZED_TARGET_BYTES),
        },
      ],
    });

    await expect(entriesOf(bytes)).rejects.toThrow('no filesystem would take');
  });
});

/**
 * The index sits in front of a comment the archive's own author writes, so where it starts is
 * settled by its account of what follows it rather than by looking for the last thing that reads
 * like one.
 */
test('a comment that spells the record it follows does not become the record', async () => {
  const bytes = zipOf({
    entries: [{ path: 'data.db', body: 'rows' }],
    comment: 'PK\x05\x06 and then some more of a comment',
  });

  const read = await entriesOf(bytes);

  expect(read.map((entry) => entry.path)).toEqual(['data.db']);
});

describe('an archive too large to describe in the records that normally would', () => {
  test('its index is found through the zip64 records instead', async () => {
    const bytes = zipOf({ entries: [{ path: 'pb_data/data.db', body: 'rows' }], zip64: true });

    const read = await entriesOf(bytes);

    expect(read.map((entry) => entry.path)).toEqual(['pb_data/data.db']);
  });

  test("an entry's lengths are read from the field its header deferred them to", async () => {
    const read = await reading([{ path: 'data.db', body: 'rows', zip64Sizes: true }]);

    expect(read[0]?.sizeBytes).toBe(ROWS_BYTES);
    expect(read[0]?.body).toBe('rows');
  });

  test('a header deferring a length to a field it does not carry ends the read', async () => {
    const bytes = zipOf({ entries: [{ path: 'data.db', body: 'rows', zip64Sizes: true }] });
    // The extra field's own id, so the walk over the extras no longer finds a zip64 one. It is
    // the last thing in the index, which the end record's 22 bytes follow.
    const extraIdAt = bytes.length - DIRECTORY_END_BYTES - ZIP64_SIZES_FIELD_BYTES;
    bytes.set(UNKNOWN_EXTRA_ID, extraIdAt);

    await expect(entriesOf(bytes)).rejects.toThrow('does not carry the zip64 field');
  });
});

/**
 * Nothing above is spelled out by a zip writer, so this is the one test that proves the read
 * against a real one — including the modes it records and the folder it puts them in.
 */
test('an archive a real zip wrote reads back as what went into it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nib-zip-real-'));
  made.push(directory);
  const source = join(directory, 'source');
  await mkdir(join(source, 'pb_data'), { recursive: true });
  await writeFile(join(source, 'pb_data', 'data.db'), 'rows', { mode: PRIVATE_FILE_MODE });
  await symlink('pb_data/data.db', join(source, 'latest'));
  const archivePath = join(directory, 'real.zip');
  await Bun.$`zip -q -r -y ${archivePath} .`.cwd(source).quiet();

  const read: ReadEntry[] = [];
  for await (const entry of zipEntries(archivePath)) {
    read.push({
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      sizeBytes: entry.sizeBytes,
      linkTarget: entry.linkTarget,
      body: '',
    });
  }

  expect(read.map((entry) => entry.path)).toEqual(['latest', 'pb_data/', 'pb_data/data.db']);
  expect(read.find((entry) => entry.path === 'latest')?.linkTarget).toBe('pb_data/data.db');
  expect(read.find((entry) => entry.path === 'pb_data/data.db')?.mode).toBe(PRIVATE_FILE_MODE);

  await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

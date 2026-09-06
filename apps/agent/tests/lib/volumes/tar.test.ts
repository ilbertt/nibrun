import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TarEntry, tarEntries, UnreadableTarball } from '#lib/volumes/tar.ts';
import {
  TYPE_CHAR_DEVICE,
  TYPE_DIRECTORY,
  TYPE_LONG_NAME,
  TYPE_SYMLINK,
  tarballOf,
} from '#tests/support/tarball.ts';

const PRIVATE_FILE_MODE = 0o640;
const PRIVATE_DIRECTORY_MODE = 0o750;
const RUNNABLE_MODE = 0o755;
const SETUID_RUNNABLE_MODE = 0o4755;
/** What `tarballOf` writes where an entry says no mode of its own. */
const DEFAULT_MODE = 0o644;
/** Longer than one block, so the walk has to count rather than take what is in hand. */
const SPANNING_BODY_BYTES = 1500;
const ROWS_BYTES = 4;
/** Longer than the 100-byte name field, which is what gnu's long-name entry exists for. */
const LONG_DIRECTORY_BYTES = 120;
const NAME_FIELD_BYTES = 99;
const SIZE_FIELD_AT = 124;
/** The high bit that says the rest of a numeric field is base 256 rather than octal text. */
const BASE_256_MARKER = 0x80;
const TRUNCATED_AT = 1024;

type ReadEntry = Pick<TarEntry, 'path' | 'kind' | 'mode' | 'sizeBytes' | 'linkTarget'> & {
  body: string;
};

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Response(bytes).body as ReadableStream<Uint8Array>;
}

async function entriesOf({
  bytes,
  reading = () => true,
}: {
  bytes: Uint8Array;
  /** Whether this entry's content is read, so that abandoning one can be exercised too. */
  reading?: (entry: TarEntry) => boolean;
}): Promise<ReadEntry[]> {
  const read: ReadEntry[] = [];
  for await (const entry of tarEntries(streamOf(bytes))) {
    const pieces: Uint8Array[] = [];
    if (reading(entry)) {
      for await (const piece of entry.content()) {
        pieces.push(piece);
      }
    }
    read.push({
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      sizeBytes: entry.sizeBytes,
      linkTarget: entry.linkTarget,
      body: new TextDecoder().decode(Buffer.concat(pieces)),
    });
  }
  return read;
}

describe('an archive is walked forwards, once', () => {
  test('every entry arrives with its header and its bytes', async () => {
    const entries = await entriesOf({
      bytes: tarballOf([
        { path: 'pb_data/', type: TYPE_DIRECTORY, mode: PRIVATE_DIRECTORY_MODE },
        { path: 'pb_data/data.db', mode: PRIVATE_FILE_MODE, body: 'rows' },
        { path: 'latest', type: TYPE_SYMLINK, linkTarget: 'pb_data/data.db' },
      ]),
    });

    expect(entries).toEqual([
      {
        path: 'pb_data/',
        kind: 'directory',
        mode: PRIVATE_DIRECTORY_MODE,
        sizeBytes: 0,
        linkTarget: '',
        body: '',
      },
      {
        path: 'pb_data/data.db',
        kind: 'file',
        mode: PRIVATE_FILE_MODE,
        sizeBytes: ROWS_BYTES,
        linkTarget: '',
        body: 'rows',
      },
      {
        path: 'latest',
        kind: 'symlink',
        mode: DEFAULT_MODE,
        sizeBytes: 0,
        linkTarget: 'pb_data/data.db',
        body: '',
      },
    ]);
  });

  test('an entry nobody read is walked past, so the one after it still lines up', async () => {
    const entries = await entriesOf({
      bytes: tarballOf([
        { path: 'skipped', body: 'x'.repeat(SPANNING_BODY_BYTES) },
        { path: 'after', body: 'here' },
      ]),
      reading: (entry) => entry.path !== 'skipped',
    });

    expect(entries.map((entry) => entry.path)).toEqual(['skipped', 'after']);
    expect(entries[1]?.body).toBe('here');
  });

  test('a device node is surfaced rather than hidden, so a caller can refuse the archive', async () => {
    const entries = await entriesOf({
      bytes: tarballOf([{ path: 'dev/null', type: TYPE_CHAR_DEVICE }]),
    });

    expect(entries[0]?.kind).toBe('unsupported');
  });

  test('the mode carries permissions and never the bits above them', async () => {
    const entries = await entriesOf({
      bytes: tarballOf([{ path: 'suid', mode: SETUID_RUNNABLE_MODE }]),
    });

    expect(entries[0]?.mode).toBe(RUNNABLE_MODE);
  });
});

describe('a path a header cannot hold still arrives whole', () => {
  test("gnu's long-name entry names the one after it", async () => {
    const long = `${'d'.repeat(LONG_DIRECTORY_BYTES)}/data.db`;
    const entries = await entriesOf({
      bytes: tarballOf([
        { path: '././@LongLink', type: TYPE_LONG_NAME, body: long },
        { path: long.slice(0, NAME_FIELD_BYTES), body: 'rows' },
      ]),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(long);
  });

  test('a ustar prefix is joined back onto the name', async () => {
    const entries = await entriesOf({
      bytes: tarballOf([{ path: 'data.db', prefix: 'deep/tree' }]),
    });

    expect(entries[0]?.path).toBe('deep/tree/data.db');
  });
});

describe('an archive that stops being followable ends the walk', () => {
  test('a source that ends inside an entry is refused', async () => {
    const whole = tarballOf([{ path: 'data.db', body: 'x'.repeat(SPANNING_BODY_BYTES) }]);

    await expect(entriesOf({ bytes: whole.slice(0, TRUNCATED_AT) })).rejects.toBeInstanceOf(
      UnreadableTarball,
    );
  });

  test('a length that is not a number is refused rather than guessed at', async () => {
    const bytes = tarballOf([{ path: 'data.db', body: 'rows' }]);
    bytes.set(new TextEncoder().encode('99z99999999'), SIZE_FIELD_AT);

    await expect(entriesOf({ bytes })).rejects.toBeInstanceOf(UnreadableTarball);
  });

  test('a length too wide for its own field is refused', async () => {
    const bytes = tarballOf([{ path: 'data.db', body: 'rows' }]);
    bytes.set([BASE_256_MARKER], SIZE_FIELD_AT);

    await expect(entriesOf({ bytes })).rejects.toBeInstanceOf(UnreadableTarball);
  });
});

/**
 * The formats a real `tar` writes rather than the ones spelled out above — pax headers among them,
 * which bsdtar emits routinely and which annotate the entry after them rather than describing a
 * file of their own.
 */
test('a tarball a real tar wrote reads back as what went into it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibrun-tar-'));
  const source = join(directory, 'source');
  await mkdir(join(source, 'pb_data'), { recursive: true });
  await writeFile(join(source, 'pb_data', 'a name with spaces.db'), 'rows');
  await symlink('pb_data/a name with spaces.db', join(source, 'latest'));
  const archive = join(directory, 'archive.tar');
  await Bun.$`tar cf ${archive} -C ${source} pb_data latest`.quiet();

  const entries = await entriesOf({ bytes: new Uint8Array(await Bun.file(archive).arrayBuffer()) });
  const byPath = new Map(entries.map((entry) => [entry.path.replace(/\/$/, ''), entry]));

  expect(byPath.get('pb_data')?.kind).toBe('directory');
  expect(byPath.get('pb_data/a name with spaces.db')?.body).toBe('rows');
  expect(byPath.get('latest')).toMatchObject({
    kind: 'symlink',
    linkTarget: 'pb_data/a name with spaces.db',
  });
});

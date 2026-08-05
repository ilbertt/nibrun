import { describe, expect, test } from 'bun:test';
import { DIRECTORY_ENTRY_LIMIT, type GuestPath, type Timestamp } from '@repo/protocol';
import { Either } from 'effect';
import { listingCommand, parseListing } from '#lib/filesystem/debugfs.ts';

const DEVICE = '/dev/nbd7';
const ROOT = '/' as GuestPath;

// Captured from `debugfs -R "ls -l /" <device>`: inode, mode, an e2fsprogs-dependent file-type
// column, owner, group, size, then the date, time and name.
const LISTING = [
  '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
  '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 ..',
  '     12  40755 (2)      0      0    4096  4-Feb-2026 09:05 pb_data',
  '     13 100644 (1)      0      0   32768 15-Jan-2026 10:24 data.db',
  '     14 120777 (7)      0      0      11 15-Jan-2026 10:24 latest.db',
  '',
].join('\n');

function listingOf(output: string) {
  return parseListing({ output, path: ROOT });
}

function entriesOf(output: string) {
  const listing = listingOf(output);
  if (Either.isLeft(listing)) {
    throw new Error('expected a readable directory');
  }
  return listing.right;
}

function at(value: string): Timestamp {
  return value as Timestamp;
}

describe('a directory is read off the columns debugfs prints', () => {
  test('each entry carries what a browser needs and nothing else', () => {
    expect(entriesOf(LISTING).entries).toEqual([
      {
        name: 'pb_data',
        kind: 'directory',
        sizeBytes: 4096,
        modifiedAt: at('2026-02-04T09:05:00Z'),
      },
      { name: 'data.db', kind: 'file', sizeBytes: 32_768, modifiedAt: at('2026-01-15T10:24:00Z') },
      { name: 'latest.db', kind: 'other', sizeBytes: 11, modifiedAt: at('2026-01-15T10:24:00Z') },
    ]);
  });

  // Everything that is not a regular file or a directory answers the same question the same way,
  // so a symlink is shown, is not descendable, and never names what it points at.
  test('a symlink is neither a file nor a way out of the volume', () => {
    const [, , link] = entriesOf(LISTING).entries;
    expect(link?.kind).toBe('other');
    expect(JSON.stringify(link)).not.toInclude('->');
  });

  test('the filesystem own bookkeeping is not an entry', () => {
    const names = entriesOf(LISTING).entries.map((entry) => entry.name);
    expect(names).not.toContain('.');
    expect(names).not.toContain('..');
  });

  // A name is whatever the tenant's binary created, and `ls -l` puts it last precisely so it can
  // be anything. Everything after the time is the name, spaces and all.
  test('a name is taken whole, however it is spelled', () => {
    const awkward = [
      '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
      '     20 100644 (1)      0      0       1 15-Jan-2026 10:23 my report v2.txt',
      '     21 100644 (1)      0      0       2 15-Jan-2026 10:23 -rf',
      "     22 100644 (1)      0      0       3 15-Jan-2026 10:23 it's",
      '     23 100644 (1)      0      0       4 15-Jan-2026 10:23 données.txt',
    ].join('\n');
    expect(entriesOf(awkward).entries.map((entry) => entry.name)).toEqual([
      'my report v2.txt',
      '-rf',
      "it's",
      'données.txt',
    ]);
  });
});

describe('what mkfs left at the root is not the tenant data', () => {
  const withLostAndFound = [
    '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
    '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 ..',
    '     11  40700 (2)      0      0   16384 15-Jan-2026 10:23 lost+found',
    '     12  40755 (2)      0      0    4096 15-Jan-2026 10:24 pb_data',
  ].join('\n');

  test('it is left out of the root', () => {
    expect(entriesOf(withLostAndFound).entries.map((entry) => entry.name)).toEqual(['pb_data']);
  });

  // The name is reserved in one directory only. Anywhere else it is a directory the tenant made,
  // and hiding it would be hiding their own data from them.
  test('but the same name below the root is the tenant own directory', () => {
    const listing = parseListing({ output: withLostAndFound, path: '/pb_data' as GuestPath });
    if (Either.isLeft(listing)) {
      throw new Error('expected a readable directory');
    }
    expect(listing.right.entries.map((entry) => entry.name)).toEqual(['lost+found', 'pb_data']);
  });
});

// `debugfs` writes its failures to stderr and exits 0 regardless, so the output is the only
// evidence. Every ext4 directory holds `.`, which separates "unreadable" from "empty" — and the
// export path's emptiness check cannot, because both look identical to it.
describe('a read that did not happen is told from a directory that is empty', () => {
  test('output with no self entry is a failed read', () => {
    expect(Either.isLeft(listingOf(''))).toBe(true);
    expect(
      Either.isLeft(listingOf('/dev/nbd7: No such file or directory while opening filesystem')),
    ).toBe(true);
  });

  test('a directory holding only its own bookkeeping is empty rather than broken', () => {
    const empty = [
      '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
      '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 ..',
    ].join('\n');
    expect(entriesOf(empty)).toEqual({ path: ROOT, entries: [], truncated: false });
  });

  // A filename containing a newline reaches us as fragments no line can parse. Dropping the
  // fragments loses that one file; failing the read would lose every file beside it.
  test('an unparseable line costs its own entry and no other', () => {
    const torn = [
      '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
      '     30 100644 (1)      0      0       9 15-Jan-2026 10:23 first',
      'half a line with no columns at all',
      '     31 100644 (1)      0      0       9 15-Jan-2026 10:23 second',
    ].join('\n');
    expect(entriesOf(torn).entries.map((entry) => entry.name)).toEqual(['first', 'second']);
  });
});

/** Root takes inode 2, so a directory's own children start above it. */
const FIRST_CHILD_INODE = 3;

function childLine(index: number): string {
  const inode = FIRST_CHILD_INODE + index;
  return `  ${inode} 100644 (1) 0 0 1 15-Jan-2026 10:23 file-${index}`;
}

test('a directory larger than the wire allows says so rather than being cut silently', () => {
  const many = [
    '      2  40755 (2)      0      0    4096 15-Jan-2026 10:23 .',
    ...Array.from(Array(DIRECTORY_ENTRY_LIMIT + 1).keys()).map(childLine),
  ].join('\n');
  const listing = entriesOf(many);
  expect(listing.entries).toHaveLength(DIRECTORY_ENTRY_LIMIT);
  expect(listing.truncated).toBe(true);
});

describe('the command is built so debugfs cannot be handed a second one', () => {
  test('a valid path is quoted into a read-only invocation', () => {
    const command = listingCommand({ devicePath: DEVICE, path: '/pb_data' as GuestPath });
    expect(Either.isRight(command) && command.right).toEqual([
      'debugfs',
      '-R',
      'ls -l "/pb_data"',
      DEVICE,
    ]);
  });

  // The schema already refuses these, so reaching this branch means a peer did not honour it —
  // which is exactly when trusting the wire would be the bug.
  test('a path the schema would have refused is refused again here', () => {
    for (const path of ['/pb_data" -R "rm /pb_data', '/..', 'relative', '/pb_data/']) {
      expect(Either.isLeft(listingCommand({ devicePath: DEVICE, path: path as GuestPath }))).toBe(
        true,
      );
    }
  });

  test('no invocation carries the write flag', () => {
    const command = listingCommand({ devicePath: DEVICE, path: ROOT });
    expect(Either.isRight(command) && command.right).not.toContain('-w');
  });
});

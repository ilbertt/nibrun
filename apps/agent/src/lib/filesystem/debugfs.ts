import {
  DIRECTORY_ENTRY_LIMIT,
  type DirectoryListing,
  type FilesystemEntry,
  type FilesystemEntryKind,
  GUEST_PATH_ROOT,
  type GuestPath,
  GuestPathSchema,
  isValidMessage,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { Data, Either } from 'effect';
import type { CommandLine } from '#lib/exec.ts';
import { MKFS_ROOT_ENTRIES } from '#lib/volumes/ext4.ts';

/**
 * Reading a tenant filesystem with `debugfs`, which walks inodes in userspace — the same reason
 * the export path uses it. The host never asks its kernel to interpret tenant-controlled
 * metadata, and no `-w` appears below, so the device is opened read-only.
 *
 * What this cannot be is exact. The guest holds the same filesystem mounted read-write, and with
 * `ignore_fsync` its writes only reach the device on ZeroFS's flush interval, so a listing lags
 * reality by roughly the flush interval plus the guest's own journal commit. Forcing a flush
 * first would make it exact and would also stall every other tenant sharing that ZeroFS, which
 * is a poor trade for a directory listing somebody is scrolling.
 */

/**
 * `debugfs -l` renders mtimes through `strftime("%d-%b-%Y %H:%M", localtime(...))`, so the host's
 * zone decides the instant and the locale decides the month name. Both are pinned here rather
 * than guessed at on the way back in.
 */
export const LISTING_ENVIRONMENT: Readonly<Record<string, string>> = { TZ: 'UTC', LC_ALL: 'C' };

const MONTH_NUMBERS: Readonly<Record<string, string>> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

const OCTAL = 8;
const DECIMAL = 10;
const TWO_DIGITS = 2;

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_MODE = 0o040000;
const REGULAR_FILE_MODE = 0o100000;

/** `.` and `..` are the filesystem's own bookkeeping; upward navigation is the dashboard's. */
const SELF_AND_PARENT = new Set(['.', '..']);

export class UnsafeGuestPath extends Data.TaggedError('UnsafeGuestPath')<{
  readonly reason: string;
}> {
  override get message() {
    return `a path this host will not read was requested: ${this.reason}`;
  }
}

export class UnreadableDirectory extends Data.TaggedError('UnreadableDirectory')<{
  readonly devicePath: string;
}> {
  /** Names the device and never the path, which is the tenant's to know and not an operator's. */
  override get message() {
    return `no directory could be read from ${this.devicePath}`;
  }
}

/**
 * Re-checked here rather than trusted from the wire, exactly as an artifact filename is: the
 * value becomes part of a command string `debugfs` tokenises the way a shell would, so a peer
 * that did not honour the schema must not be able to append a second command.
 */
export function listingCommand({
  devicePath,
  path,
}: {
  devicePath: string;
  path: GuestPath;
}): Either.Either<CommandLine, UnsafeGuestPath> {
  if (!isValidMessage({ schema: GuestPathSchema, value: path })) {
    return Either.left(new UnsafeGuestPath({ reason: 'it is not an absolute in-volume path' }));
  }
  return Either.right(['debugfs', '-R', `ls -l "${path}"`, devicePath]);
}

function kindFor(mode: number): FilesystemEntryKind {
  const type = mode & FILE_TYPE_MASK;
  if (type === DIRECTORY_MODE) {
    return 'directory';
  }
  return type === REGULAR_FILE_MODE ? 'file' : 'other';
}

function timestampFrom({ date, time }: { date: string; time: string }): Timestamp | undefined {
  const [day, month, year] = date.split('-');
  const [hour, minute] = time.split(':');
  const monthNumber = month ? MONTH_NUMBERS[month] : undefined;
  if (!(day && monthNumber && year && hour && minute)) {
    return undefined;
  }
  const paddedDay = day.padStart(TWO_DIGITS, '0');
  const paddedHour = hour.padStart(TWO_DIGITS, '0');
  return Value.Parse(
    TimestampSchema,
    `${year}-${monthNumber}-${paddedDay}T${paddedHour}:${minute}:00Z`,
  );
}

/**
 * Anchored on the date rather than on a fixed column count: the `(filetype)` column `ls -l` emits
 * between the mode and the owner is not present in every e2fsprogs, and the entry name is
 * whatever follows the time — including spaces, quotes and dashes, none of which a tenant needs
 * our permission to use.
 */
const ENTRY_PATTERN = /^(.*?)\s(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{1,2}:\d{2})\s(.*)$/;

type ParsedEntry = { readonly name: string; readonly entry: FilesystemEntry };

function parseEntry(line: string): ParsedEntry | undefined {
  const matched = ENTRY_PATTERN.exec(line);
  if (!matched) {
    return undefined;
  }
  const [, columns = '', date = '', time = '', name = ''] = matched;
  const numbers = columns.trim().split(/\s+/);
  // Inode first, mode second, size last. Between them sit owner, group and possibly a file-type
  // column, none of which a read-only browser has a use for.
  const mode = numbers[1];
  const size = numbers.at(-1);
  const modifiedAt = timestampFrom({ date, time });
  if (!(mode && size && modifiedAt) || name.length === 0) {
    return undefined;
  }
  const parsedMode = Number.parseInt(mode, OCTAL);
  const parsedSize = Number.parseInt(size, DECIMAL);
  if (Number.isNaN(parsedMode) || Number.isNaN(parsedSize)) {
    return undefined;
  }
  return {
    name,
    entry: { name, kind: kindFor(parsedMode), sizeBytes: parsedSize, modifiedAt },
  };
}

/**
 * `debugfs` reports a failed read on stderr and still exits 0, so the output is the only thing
 * that can say whether it worked. Every ext4 directory holds `.`, which makes its absence a
 * far sharper signal than emptiness — an unreadable device and a directory a tenant emptied
 * both produce no entries, and only one of them is a failure.
 *
 * A line that does not parse is dropped rather than failing the read: a filename containing a
 * newline arrives as fragments, and one such file must not blank the directory holding it.
 */
export function parseListing({
  output,
  path,
}: {
  output: string;
  path: GuestPath;
}): Either.Either<DirectoryListing, 'no-directory'> {
  const entries: FilesystemEntry[] = [];
  const atRoot = path === GUEST_PATH_ROOT;
  let sawSelf = false;
  let truncated = false;

  for (const line of output.split('\n')) {
    const parsed = parseEntry(line);
    if (!parsed) {
      continue;
    }
    if (SELF_AND_PARENT.has(parsed.name)) {
      sawSelf ||= parsed.name === '.';
      continue;
    }
    if (atRoot && MKFS_ROOT_ENTRIES.has(parsed.name)) {
      continue;
    }
    if (entries.length === DIRECTORY_ENTRY_LIMIT) {
      truncated = true;
      break;
    }
    entries.push(parsed.entry);
  }

  return sawSelf ? Either.right({ path, entries, truncated }) : Either.left('no-directory');
}

// What the two archive readers agree on, which is everything the unpack asks of an entry.
//
// A tarball and a zip are read by different mechanics — one forwards through a stream, one from the
// index at its end — and `seed.ts` is the same code over either: what it refuses is a path, a kind
// and a length, none of which belong to a format.

/**
 * What an unpack does with an entry. Everything that is not one of the first three is a refusal —
 * a device node, a fifo, a hard link — so they are not told apart here: what a caller does with
 * any of them is refuse the archive and name the entry.
 */
export type ArchiveEntryKind = 'file' | 'directory' | 'symlink' | 'unsupported';

export type ArchiveEntry = {
  readonly path: string;
  readonly kind: ArchiveEntryKind;
  /** Permissions only. The bits above them say setuid, and nothing here carries those. */
  readonly mode: number;
  readonly sizeBytes: number;
  /** Where a symlink points, as the archive wrote it; empty for everything else. */
  readonly linkTarget: string;
  /** The entry's own bytes. A tarball's are readable only until the next entry is asked for. */
  content(): AsyncGenerator<Uint8Array>;
};

/**
 * What an archive that stops being followable is raised as, wherever it stops being one.
 *
 * The reason is the reader's own sentence and reaches an operator's log through `SeedUnreadable`,
 * so it names what is wrong with the archive and never a path, which is a tenant's own text.
 */
export class UnreadableArchive extends Error {
  constructor(reason: string) {
    super(`the archive ${reason}`);
    this.name = 'UnreadableArchive';
  }
}

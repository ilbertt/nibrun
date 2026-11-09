/**
 * Generated from https://raw.githubusercontent.com/ilbertt/nibrunner/v2026.11.5/crates/nibrunnerd/filesystem.openapi.json
 * Run bun run --filter @repo/internal-scripts generate-nibrunner-types; do not edit.
 */

/**
 * What one entry in a directory is. Anything that is neither a file nor a directory — a socket,
 * a device node, a symbolic link — is `other`.
 */
export type FilesystemEntryKind = 'file' | 'directory' | 'other';
/**
 * an ISO 8601 instant with an offset
 */
export type Timestamp = string;

/**
 * What one directory inside a guest holds.
 */
export interface DirectoryListing {
  /**
   * Sorted by `name`. `lost+found` is left out of the guest's root, because the filesystem
   * the volume was made with put it there and no app did.
   */
  entries: FilesystemEntry[];
  /**
   * The directory listed, as it was asked for.
   */
  path: string;
  /**
   * The directory held more entries than one answer carries, and `entries` is cut.
   */
  truncated: boolean;
  [k: string]: unknown;
}
/**
 * One entry of a directory, as the guest measured it.
 */
export interface FilesystemEntry {
  kind: FilesystemEntryKind;
  modifiedAt: Timestamp;
  /**
   * The entry alone, not the path it was reached by.
   */
  name: string;
  /**
   * What the entry takes, as the guest's own filesystem reports it.
   */
  sizeBytes: number;
  [k: string]: unknown;
}

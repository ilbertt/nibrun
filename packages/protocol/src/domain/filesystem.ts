import { type TString, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import type { Brand, BrandedSchema } from '#lib/brand.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, TimestampSchema } from '#lib/wire.ts';

/**
 * Domain rather than control, for the same reason a log record is: the agent reads a listing off
 * a tenant device and the api hands it to a dashboard, so neither sends the other one as a
 * message — but the two would drift apart silently if the shape lived in either app.
 *
 * A listing is one directory's children, flat. Nothing here nests, and nothing here is a tree:
 * the wire carries what a person is looking at, and the path back to the root is the dashboard's
 * own navigation state. That is what keeps the cost of listing a filesystem independent of how
 * large the filesystem is.
 */

/**
 * `other` is every symlink, socket, fifo and device node.
 *
 * They are named rather than hidden, because a file a tenant can see and we do not show is worse
 * than one we decline to open — and collapsed together rather than told apart, because the only
 * question a read-only browser asks is whether descending is meaningful. It also means nothing
 * here has to describe a symlink target, so no listing can point out of the tenant's filesystem.
 */
export const FILESYSTEM_ENTRY_KINDS = ['file', 'directory', 'other'] as const;

export const FilesystemEntryKindSchema = stringEnum(FILESYSTEM_ENTRY_KINDS);

export type FilesystemEntryKind = (typeof FILESYSTEM_ENTRY_KINDS)[number];

/**
 * Deliberately permissive, and the asymmetry with `GuestPathSchema` below is the point: a name is
 * reported, a path is accepted. The tenant's own binary created these, so anything ext4 allows —
 * a leading dash, a space, a quote, a newline — has to survive being described. Refusing one here
 * would not stop the file existing; it would only stop its owner seeing it.
 */
const MAX_ENTRY_NAME_LENGTH = 255;
const ENTRY_NAME_PATTERN = '^[^/\\u0000]+$';

export const FilesystemEntryNameSchema = Type.String({
  description: 'One directory entry name, exactly as it is stored on the tenant filesystem.',
  pattern: ENTRY_NAME_PATTERN,
  minLength: 1,
  maxLength: MAX_ENTRY_NAME_LENGTH,
});

/**
 * An absolute path inside one tenant's filesystem, where its root is the volume's own root — the
 * `data/` a tenant's binary writes to, and nothing above it.
 *
 * Strict where a name is permissive, because this is the direction that carries a request. `.`
 * and `..` are excluded outright rather than resolved: a browser that never resolves a path
 * cannot be walked out of the filesystem it was scoped to. Quotes and backslashes are excluded
 * because the value ends up in a command string the reader's tooling tokenises the way a shell
 * would — so a directory named `it's` can be listed by name but not descended into, which is the
 * price of never handing that tooling a second command.
 */
const MAX_GUEST_PATH_LENGTH = 4096;
const PATH_SEGMENT_CHARACTERS = '[^/\\\\"\'\\u0000-\\u001f]';
const NOT_A_TRAVERSAL = '(?!\\.{1,2}(?:/|$))';
const PATH_SEGMENT = `${NOT_A_TRAVERSAL}${PATH_SEGMENT_CHARACTERS}+`;
const GUEST_PATH_PATTERN = `^/(?:${PATH_SEGMENT}(?:/${PATH_SEGMENT})*)?$`;

export type GuestPath = Brand<string, 'GuestPath'>;

// Branded apart from the host paths it sits beside in the agent: a device path and a path inside
// the filesystem that device holds are both strings, and only one of them is a tenant's to name.
export const GuestPathSchema = Type.String({
  description: 'Absolute path within a tenant volume. No `.`, no `..`, no trailing slash.',
  pattern: GUEST_PATH_PATTERN,
  minLength: 1,
  maxLength: MAX_GUEST_PATH_LENGTH,
}) as BrandedSchema<TString, GuestPath>;

export const GUEST_PATH_ROOT = Value.Parse(GuestPathSchema, '/');

export const FilesystemEntrySchema = Type.Object({
  name: FilesystemEntryNameSchema,
  kind: FilesystemEntryKindSchema,
  sizeBytes: ByteSizeSchema,
  modifiedAt: TimestampSchema,
});

export type FilesystemEntry = typeof FilesystemEntrySchema.static;

/**
 * `truncated` rather than a cursor, while the answer is a single read of a single directory.
 * Paging needs a key that survives between two reads of a filesystem being written to underneath
 * it, and there is no such key here that is not an inode — so this says plainly that there is
 * more, instead of offering a way to walk it that would quietly skip and repeat entries.
 */
export const DIRECTORY_ENTRY_LIMIT = 1000;

export const DirectoryListingSchema = Type.Object({
  path: GuestPathSchema,
  entries: Type.Array(FilesystemEntrySchema, { maxItems: DIRECTORY_ENTRY_LIMIT }),
  truncated: Type.Boolean(),
});

export type DirectoryListing = typeof DirectoryListingSchema.static;

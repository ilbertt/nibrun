import type { Print } from '@parshjs/core';
import {
  DIRECTORY_ENTRY_LIMIT,
  FILESYSTEM_ENTRY_KINDS,
  type FilesystemEntry,
  type GuestPath,
  GuestPathSchema,
  Value,
} from '@repo/protocol';
import { type Api, unwrap } from '#lib/api.ts';
import { addressedDeployment } from '#lib/apps.ts';
import { UsageError } from '#lib/errors.ts';

const KIND_WIDTH = Math.max(...FILESYSTEM_ENTRY_KINDS.map((kind) => kind.length));

const DAY_AND_MINUTE_END = 16;

/**
 * What was typed, as a path the api will take.
 *
 * A path here is absolute because there is nothing for it to be relative to — the volume's root
 * is the only place it can start — so a leading slash is spelling rather than meaning, and one
 * left off is supplied rather than refused. A trailing one is the same. Nothing else is repaired:
 * `.` and `..` are refused by the schema on purpose, and resolving them here is exactly what
 * would put a caller outside the filesystem they were scoped to.
 */
export function guestPath(typed: string): GuestPath {
  const absolute = typed.startsWith('/') ? typed : `/${typed}`;
  const spelled = absolute.length > 1 ? absolute.replace(/\/$/, '') : absolute;
  try {
    return Value.Parse(GuestPathSchema, spelled);
  } catch {
    throw new UsageError(`${typed} is not a path inside an app filesystem.`);
  }
}

export type ListInput = {
  api: Api;
  slug: string;
  deploymentId: string | undefined;
  path: GuestPath;
  print: Print;
};

/**
 * Print one directory of an app's filesystem.
 *
 * The request is held open by the api until a host next polls, so this is a wait rather than a
 * read — hence the deployment being named before it starts rather than alongside the answer.
 */
export async function listDirectory({
  api,
  slug,
  deploymentId,
  path,
  print,
}: ListInput): Promise<void> {
  const addressed = await addressedDeployment({ api, slug, deploymentId, print });
  const listing = unwrap(
    await api.api
      .apps({ appId: addressed.appId })
      .deployments({ deploymentId: addressed.deploymentId })
      .filesystem.get({ query: { path } }),
  );

  for (const line of render(listing.entries)) {
    print.info(line);
  }
  if (listing.truncated) {
    print.warn(`Only the first ${DIRECTORY_ENTRY_LIMIT} entries of ${listing.path} are shown.`);
  }
}

/**
 * Sorted here because the order on the wire is the directory's own, which is an implementation
 * detail of the filesystem and not something a reader looking for a name can use.
 *
 * The name goes last because it is the one field the tenant chose: anything ext4 allows is in it,
 * including a newline, and a column after it would be the one that breaks.
 *
 * Sizes stay exact rather than rounded, because someone reading a tenant's filesystem is checking
 * what their binary wrote, and `1.2 MiB` is what a second listing cannot be compared against.
 */
export function render(entries: readonly FilesystemEntry[]): string[] {
  const sizeWidth = Math.max(0, ...entries.map((entry) => String(entry.sizeBytes).length));
  return byName(entries).map((entry) =>
    [
      entry.kind.padEnd(KIND_WIDTH),
      String(entry.sizeBytes).padStart(sizeWidth),
      modifiedAt(entry.modifiedAt),
      entry.name,
    ].join(' '),
  );
}

function byName(entries: readonly FilesystemEntry[]): FilesystemEntry[] {
  // biome-ignore lint/complexity/useMaxParams: a comparator compares two entries
  return [...entries].sort((left, right) => (left.name < right.name ? -1 : 1));
}

/**
 * The date as well as the time, unlike a log line: what a log holds is what just happened, and
 * what a filesystem holds may have been written months ago. UTC, as logs are.
 */
function modifiedAt(instant: string): string {
  return new Date(instant).toISOString().slice(0, DAY_AND_MINUTE_END).replace('T', ' ');
}

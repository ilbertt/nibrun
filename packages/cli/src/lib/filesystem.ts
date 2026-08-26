import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import {
  describeUnreadableFilesystem,
  guestPath,
  InvalidPathError,
  readDirectory,
} from '@repo/app-operations';
import {
  DIRECTORY_ENTRY_LIMIT,
  FILESYSTEM_ENTRY_KINDS,
  type FilesystemEntry,
  type GuestPath,
} from '@repo/protocol';
import { announcedDeployment } from '#lib/apps.ts';
import { UsageError } from '#lib/errors.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

const KIND_WIDTH = Math.max(...FILESYSTEM_ENTRY_KINDS.map((kind) => kind.length));

export function typedPath(typed: string): GuestPath {
  try {
    return guestPath(typed);
  } catch (failure) {
    if (failure instanceof InvalidPathError) {
      throw new UsageError(failure.message);
    }
    throw failure;
  }
}

export type ListInput = {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
  path: GuestPath;
  print: Print;
};

/**
 * Print one directory of an app's filesystem.
 *
 * The request is held open by the api until a host next polls, so this is a wait rather than a
 * read — hence the deployment being named before it starts rather than alongside the answer, and
 * hence a release that failed being answered from here: the wait is the expensive part, and what
 * it buys in that case is a refusal that names neither the release nor why it never came up.
 */
export async function listDirectory({
  api,
  slug,
  deploymentId,
  path,
  print,
}: ListInput): Promise<void> {
  const addressed = await announcedDeployment({ api, slug, deploymentId, print });

  const unreadable = describeUnreadableFilesystem(addressed.newest);
  if (unreadable !== undefined) {
    throw new ApiError(unreadable);
  }

  const listing = await readDirectory({
    api,
    appId: addressed.appId,
    deploymentId: addressed.deploymentId,
    path,
  });

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
      dayAndMinute(entry.modifiedAt),
      entry.name,
    ].join(' '),
  );
}

function byName(entries: readonly FilesystemEntry[]): FilesystemEntry[] {
  // biome-ignore lint/complexity/useMaxParams: a comparator compares two entries
  return [...entries].sort((left, right) => (left.name < right.name ? -1 : 1));
}

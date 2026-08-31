import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { guestPath, InvalidPathError, readDirectory } from '@repo/app-operations';
import { DIRECTORY_ENTRY_LIMIT, FILESYSTEM_ENTRY_KINDS, type GuestPath } from '@repo/protocol';
import { z } from 'zod';
import { announcedDeployment } from '#lib/apps.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

const KIND_WIDTH = Math.max(...FILESYSTEM_ENTRY_KINDS.map((kind) => kind.length));

const EntrySchema = z.object({
  name: z.string(),
  kind: z.enum(FILESYSTEM_ENTRY_KINDS),
  sizeBytes: z.number(),
  modifiedAt: z.string(),
});

type Entry = z.infer<typeof EntrySchema>;

/**
 * The deployment as well as the directory: which release was read is a question rather than a
 * default when no `--deployment-id` named one, and its answer is the difference between reading
 * what an app is writing now and what the release before it left behind.
 */
const DirectorySchema = z.object({
  slug: z.string(),
  deploymentId: z.string(),
  path: z.string(),
  truncated: z.boolean(),
  entries: z.array(EntrySchema),
});

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

export const DIRECTORY_OUTPUT = defineOutput({
  schema: DirectorySchema,
  render: ({ value, out }) => {
    for (const line of render(value.entries)) {
      out.info(line);
    }
    if (value.truncated) {
      out.warn(`Only the first ${DIRECTORY_ENTRY_LIMIT} entries of ${value.path} are shown.`);
    }
  },
});

export type ListInput = {
  api: PublicApiClient;
  slug: string;
  deploymentId: string | undefined;
  path: GuestPath;
  print: Print;
};

/**
 * One directory of an app's filesystem.
 *
 * The request is held open by the api until a host next polls, so this is a wait rather than a
 * read — hence the deployment being named before it starts rather than alongside the answer, and
 * hence an app with nothing mounting its filesystem being answered before it: the wait is the
 * expensive part, and what it buys is a refusal that names neither the app nor why.
 */
export async function listDirectory({
  api,
  slug,
  deploymentId,
  path,
  print,
}: ListInput): Promise<z.input<typeof DirectorySchema>> {
  const addressed = await announcedDeployment({
    api,
    slug,
    deploymentId,
    operation: 'files',
    print,
  });

  const listing = await readDirectory({
    api,
    appId: addressed.appId,
    deploymentId: addressed.deploymentId,
    path,
  });

  return {
    slug: addressed.slug,
    deploymentId: addressed.deploymentId,
    path: listing.path,
    truncated: listing.truncated,
    entries: listing.entries,
  };
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
export function render(entries: readonly Entry[]): string[] {
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

function byName(entries: readonly Entry[]): Entry[] {
  // biome-ignore lint/complexity/useMaxParams: a comparator compares two entries
  return [...entries].sort((left, right) => (left.name < right.name ? -1 : 1));
}

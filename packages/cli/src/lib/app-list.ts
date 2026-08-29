import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import type { ListedApp } from '@repo/app-operations';
import { APP_STATES } from '@repo/protocol';
import { NO_APPS } from '#lib/apps.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

export type AppListing = Pick<
  ListedApp,
  'slug' | 'state' | 'updatedAt' | 'config' | 'volumeUsage' | 'computeUsage'
>;

// `LAST CHANGE` rather than `UPDATED`, which reads as the owner having done it: the row moves on
// a config patch or a state change, and a deploy leaves it alone entirely.
const HEADINGS = {
  slug: 'SLUG',
  state: 'STATE',
  cpu: 'CPU',
  memory: 'MEM',
  volume: 'VOLUME',
  updated: 'LAST CHANGE',
};

const COLUMN_GAP = '  ';

const BYTES_PER_MIB = 1_048_576;

// Every state the column can ever hold, so a suspended app appearing in a later listing does not
// move the columns of the one before it.
const STATE_WIDTH = Math.max(HEADINGS.state.length, ...APP_STATES.map((state) => state.length));

const PERCENT_SCALE = 100;
const FULL = 1;

/** An app nothing has ever measured, which is every app that has not yet run. */
const UNMEASURED = '-';

// Sized for every share the column can hold rather than for the rows in front of it, the way the
// state column beside it is: `100%` is four characters, so a listing of one app lines up with a
// listing of ten.
function shareWidth(heading: string): number {
  return Math.max(heading.length, `${PERCENT_SCALE}%`.length);
}

/**
 * A share rather than a size, because these columns sit in a list: what an owner scanning one is
 * looking for is the app that is filling up or pinning a core, and the bytes behind it are a line
 * on that app's own page.
 */
function share(measured: number | undefined): string {
  return measured === undefined
    ? UNMEASURED
    : `${Math.round(Math.min(measured, FULL) * PERCENT_SCALE)}%`;
}

/** Print what the owner has, one app to a line. */
export async function listApps({
  api,
  print,
}: {
  api: PublicApiClient;
  print: Print;
}): Promise<void> {
  const { apps } = unwrap(await api.api.apps.get());
  if (apps.length === 0) {
    print.dim(NO_APPS);
    return;
  }

  for (const line of render(apps)) {
    print.info(line);
  }
}

/**
 * Left in the order the api answered with, which is newest first — the order an owner made these
 * in is the one they remember them in, and sorting by slug would bury the app they just deployed
 * somewhere in the middle.
 *
 * A heading, unlike the filesystem listing: there a name and a size say what they are, and here
 * every column but one is a number that would read as any of the others.
 */
export function render(apps: readonly AppListing[]): string[] {
  const rows = [HEADINGS, ...apps.map(toRow)];
  const slugWidth = Math.max(...rows.map((row) => row.slug.length));

  return rows.map((row) =>
    [
      row.slug.padEnd(slugWidth),
      row.state.padEnd(STATE_WIDTH),
      row.cpu.padStart(shareWidth(HEADINGS.cpu)),
      row.memory.padStart(shareWidth(HEADINGS.memory)),
      row.volume.padStart(shareWidth(HEADINGS.volume)),
      row.updated,
    ].join(COLUMN_GAP),
  );
}

function toRow(app: AppListing) {
  const compute = app.computeUsage;
  return {
    slug: app.slug,
    state: app.state,
    cpu: share(compute?.cpuShare),
    memory: share(
      compute
        ? compute.memoryUsedBytes / (app.config.resources.memoryMib * BYTES_PER_MIB)
        : undefined,
    ),
    volume: share(
      app.volumeUsage ? app.volumeUsage.usedBytes / app.config.volumeSizeBytes : undefined,
    ),
    updated: dayAndMinute(app.updatedAt),
  };
}

import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { APP_STATES, type App } from '@repo/protocol';
import { NO_APPS } from '#lib/apps.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

export type AppListing = Pick<App, 'slug' | 'state' | 'updatedAt'>;

// `LAST CHANGE` rather than `UPDATED`, which reads as the owner having done it: the row moves on
// a config patch or a state change, and a deploy leaves it alone entirely.
const HEADINGS = { slug: 'SLUG', state: 'STATE', updated: 'LAST CHANGE' };

const COLUMN_GAP = '  ';

// Every state the column can ever hold, so a suspended app appearing in a later listing does not
// move the columns of the one before it.
const STATE_WIDTH = Math.max(HEADINGS.state.length, ...APP_STATES.map((state) => state.length));

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
 * two of the three columns are words that would read as the app's own.
 */
export function render(apps: readonly AppListing[]): string[] {
  const rows = [HEADINGS, ...apps.map(toRow)];
  const slugWidth = Math.max(...rows.map((row) => row.slug.length));

  return rows.map((row) =>
    [row.slug.padEnd(slugWidth), row.state.padEnd(STATE_WIDTH), row.updated].join(COLUMN_GAP),
  );
}

function toRow(app: AppListing) {
  return { slug: app.slug, state: app.state, updated: dayAndMinute(app.updatedAt) };
}

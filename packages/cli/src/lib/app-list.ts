import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import type { ListedApp } from '@repo/app-operations';
import { APP_STATES } from '@repo/protocol';
import { z } from 'zod';
import { NO_APPS } from '#lib/apps.ts';
import { defineOutput } from '#lib/output.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

/**
 * What is spent of one resource and what there is of it, in bytes. Both figures rather than the
 * share the column shows: a share is what a listing is read down, and the bytes behind it are
 * what anything reading this with a program would have had to reconstruct.
 */
const MeasuredSchema = z.object({
  /** `null` for an app nothing has measured, which is every app that has not yet run. */
  usedBytes: z.number().nullable(),
  totalBytes: z.number(),
});

const AppRowSchema = z.object({
  slug: z.string(),
  state: z.enum(APP_STATES),
  updatedAt: z.string(),
  cpuShare: z.number().nullable(),
  memory: MeasuredSchema,
  volume: MeasuredSchema,
});

export type AppRow = z.infer<typeof AppRowSchema>;

/** The half of the api's answer a row is read off. */
type AppListing = Pick<
  ListedApp,
  'slug' | 'state' | 'updatedAt' | 'config' | 'volumeUsage' | 'computeUsage'
>;

const AppListSchema = z.object({ apps: z.array(AppRowSchema) });

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
function share(measured: number | null): string {
  return measured === null
    ? UNMEASURED
    : `${Math.round(Math.min(measured, FULL) * PERCENT_SCALE)}%`;
}

function ratio({ usedBytes, totalBytes }: z.infer<typeof MeasuredSchema>): number | null {
  return usedBytes === null ? null : usedBytes / totalBytes;
}

export const APP_LIST_OUTPUT = defineOutput({
  schema: AppListSchema,
  render: ({ value, out }) => {
    if (value.apps.length === 0) {
      out.dim(NO_APPS);
      return;
    }
    for (const line of render(value.apps)) {
      out.info(line);
    }
  },
});

/** What the owner has, one app to a row. */
export async function listApps({
  api,
}: {
  api: PublicApiClient;
}): Promise<z.input<typeof AppListSchema>> {
  const { apps } = unwrap(await api.api.apps.get());
  return { apps: apps.map(toRow) };
}

function toRow(app: AppListing): AppRow {
  return {
    slug: app.slug,
    state: app.state,
    updatedAt: app.updatedAt,
    cpuShare: app.computeUsage?.cpuShare ?? null,
    memory: {
      usedBytes: app.computeUsage?.memoryUsedBytes ?? null,
      totalBytes: app.config.resources.memoryMib * BYTES_PER_MIB,
    },
    volume: {
      usedBytes: app.volumeUsage?.usedBytes ?? null,
      totalBytes: app.config.volumeSizeBytes,
    },
  };
}

/**
 * Left in the order the api answered with, which is newest first — the order an owner made these
 * in is the one they remember them in, and sorting by slug would bury the app they just deployed
 * somewhere in the middle.
 *
 * A heading, unlike the filesystem listing: there a name and a size say what they are, and here
 * every column but one is a number that would read as any of the others.
 */
export function render(apps: readonly AppRow[]): string[] {
  const rows = [HEADINGS, ...apps.map(toColumns)];
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

function toColumns(app: AppRow) {
  return {
    slug: app.slug,
    state: app.state,
    cpu: share(app.cpuShare),
    memory: share(ratio(app.memory)),
    volume: share(ratio(app.volume)),
    updated: dayAndMinute(app.updatedAt),
  };
}

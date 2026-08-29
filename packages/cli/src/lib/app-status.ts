import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import {
  APP_STATUS_LABELS,
  type AppStatusKey,
  appWithStatus,
  type ListedApp,
  statusKey,
} from '@repo/app-operations';
import { formatBytes } from '#lib/format-bytes.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

export type AppStatusView = Pick<ListedApp, 'slug' | 'config' | 'volumeUsage' | 'computeUsage'> & {
  /**
   * What the app is doing, not what its row says. An app row is `active` from the moment it is
   * created, so on its own it says nothing about whether anything is serving — the release
   * answers that, and `running` is the word an owner is looking for here.
   */
  status: AppStatusKey;
};

const BYTES_PER_MIB = 1_048_576;

/** Two decimals, because a tenth of a vCPU is the difference between idle and doing something. */
const VCPU_DECIMALS = 2;

/** An app nothing has measured, which is every app that is not running and has never run. */
const UNMEASURED = '-';

const LABEL_WIDTH = 'Memory'.length;

type Resource = {
  label: string;
  /** What is spent over what there is, already read as one thing: `1.4 GiB / 8.0 GiB`. */
  spent: string;
  measuredAt: string | undefined;
};

function spent({ used, total }: { used: string | undefined; total: string }): string {
  return `${used ?? UNMEASURED} / ${total}`;
}

/** The table, and the one moment printed under it — dimmed, which is the caller's to do. */
export type RenderedStatus = { lines: string[]; measured: string | undefined };

/**
 * The oldest reading's moment, not the newest.
 *
 * One line rather than three because the two readings are taken in the same pass and almost
 * always carry the same moment, so saying it three times says nothing twice. They can still come
 * apart — they are two exchanges with the guest, and one can be refused while the other answers —
 * and the oldest is the summary that stays true when they do. The newest would date a stale
 * reading as fresh, which is the one thing a moment is here to stop.
 */
function measuredAt(moments: readonly (string | undefined)[]): string | undefined {
  const taken = moments.filter((moment) => moment !== undefined);
  let oldest: string | undefined;
  for (const moment of taken) {
    if (oldest === undefined || Date.parse(moment) < Date.parse(oldest)) {
      oldest = moment;
    }
  }
  return oldest;
}

/**
 * What the app is using of what it was given, one resource to a line.
 *
 * Sizes where the listing prints shares: a listing is read to find the app that is filling up, and
 * this is read once that app is found — so the question here is how much, which a percentage does
 * not answer.
 */
export function renderStatus(app: AppStatusView): RenderedStatus {
  const compute = app.computeUsage;
  const volume = app.volumeUsage;
  const memoryBytes = app.config.resources.memoryMib * BYTES_PER_MIB;

  const resources: Resource[] = [
    {
      label: 'vCPU',
      spent: spent({
        used:
          compute?.cpuShare === undefined
            ? undefined
            : (compute.cpuShare * app.config.resources.vcpuCount).toFixed(VCPU_DECIMALS),
        total: String(app.config.resources.vcpuCount),
      }),
      measuredAt: compute?.cpuShare === undefined ? undefined : compute.measuredAt,
    },
    {
      label: 'Memory',
      spent: spent({
        used: compute ? formatBytes(compute.memoryUsedBytes) : undefined,
        total: formatBytes(memoryBytes),
      }),
      measuredAt: compute?.measuredAt,
    },
    {
      label: 'Volume',
      spent: spent({
        used: volume ? formatBytes(volume.usedBytes) : undefined,
        total: formatBytes(app.config.volumeSizeBytes),
      }),
      measuredAt: volume?.measuredAt,
    },
  ];

  const taken = measuredAt(resources.map((resource) => resource.measuredAt));

  return {
    lines: [
      `${app.slug}  ${APP_STATUS_LABELS[app.status]}`,
      '',
      ...resources.map((resource) =>
        `${resource.label.padEnd(LABEL_WIDTH)}  ${resource.spent}`.trimEnd(),
      ),
    ],
    measured: taken ? `measured at ${dayAndMinute(taken)}` : undefined,
  };
}

export async function showStatus({
  api,
  slug,
  print,
}: {
  api: PublicApiClient;
  slug: string;
  print: Print;
}): Promise<void> {
  const { app, status } = await appWithStatus({ api, slug });
  const { lines, measured } = renderStatus({ ...app, status: statusKey(status) });
  for (const line of lines) {
    print.info(line);
  }
  // Under the table and dimmed, because it qualifies every figure above rather than being one.
  if (measured) {
    print.info('');
    print.dim(measured);
  }
}

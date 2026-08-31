import type { PublicApiClient } from '@repo/api-client/public';
import {
  APP_STATUS_LABELS,
  type AppStatusKey,
  activationSummary,
  appWithStatus,
  statusKey,
} from '@repo/app-operations';
import { APP_ACTIVATIONS } from '@repo/protocol';
import { z } from 'zod';
import { formatBytes } from '#lib/format-bytes.ts';
import { defineOutput } from '#lib/output.ts';
import { dayAndMinute } from '#lib/timestamp.ts';

// `Object.keys` is typed `string[]`, and an exhaustive `Record<AppStatusKey, …>` is the one place
// the whole set is written down — so the tuple is read off it rather than repeated here.
const STATUS_KEYS = Object.keys(APP_STATUS_LABELS) as [AppStatusKey, ...AppStatusKey[]];

/**
 * What is spent of one resource, what there is of it, and when that was last looked at. The
 * moment is per resource because the readings are two exchanges with the guest and can come
 * apart; what a reader is shown is the older of them, which is the renderer's to work out.
 */
const SpentSchema = z.object({
  /** `null` for a resource nothing has measured, which is every app that is not running. */
  used: z.number().nullable(),
  total: z.number(),
  measuredAt: z.string().nullable(),
});

type Spent = z.infer<typeof SpentSchema>;

const AppStatusSchema = z.object({
  slug: z.string(),
  /**
   * What the app is doing, not what its row says. An app row is `active` from the moment it is
   * created, so on its own it says nothing about whether anything is serving — the release
   * answers that, and `running` is the word an owner is looking for here.
   */
  status: z.enum(STATUS_KEYS),
  /**
   * How the app comes up, as the two fields rather than the sentence they are rendered into: a
   * caller reading `--json` is deciding something, and a timeout it would have to parse back out
   * of `stopped after 15m of quiet` is one this has taken away from it.
   */
  activation: z.enum(APP_ACTIVATIONS),
  idleTimeoutMs: z.number(),
  /** In vCPUs, so it is read against the count beside it rather than as a share of it. */
  vcpu: SpentSchema,
  memory: SpentSchema,
  volume: SpentSchema,
});

export type AppStatusReport = z.infer<typeof AppStatusSchema>;

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
  measuredAt: string | null;
};

/**
 * The oldest reading's moment, not the newest.
 *
 * One line rather than three because the two readings are taken in the same pass and almost
 * always carry the same moment, so saying it three times says nothing twice. They can still come
 * apart — they are two exchanges with the guest, and one can be refused while the other answers —
 * and the oldest is the summary that stays true when they do. The newest would date a stale
 * reading as fresh, which is the one thing a moment is here to stop.
 */
function measuredAt(moments: readonly (string | null)[]): string | undefined {
  let oldest: string | undefined;
  for (const moment of moments) {
    if (moment !== null && (oldest === undefined || Date.parse(moment) < Date.parse(oldest))) {
      oldest = moment;
    }
  }
  return oldest;
}

/** The table, and the one moment printed under it — dimmed, which is the caller's to do. */
export type RenderedStatus = { lines: string[]; measured: string | undefined };

function counted({ label, spent }: { label: string; spent: Spent }): Resource {
  return {
    label,
    spent: `${spent.used === null ? UNMEASURED : spent.used.toFixed(VCPU_DECIMALS)} / ${spent.total}`,
    measuredAt: spent.measuredAt,
  };
}

function sized({ label, spent }: { label: string; spent: Spent }): Resource {
  return {
    label,
    spent: `${spent.used === null ? UNMEASURED : formatBytes(spent.used)} / ${formatBytes(spent.total)}`,
    measuredAt: spent.measuredAt,
  };
}

/**
 * What the app is using of what it was given, one resource to a line.
 *
 * Sizes where the listing prints shares: a listing is read to find the app that is filling up, and
 * this is read once that app is found — so the question here is how much, which a percentage does
 * not answer.
 */
export function renderStatus(app: AppStatusReport): RenderedStatus {
  const resources: Resource[] = [
    counted({ label: 'vCPU', spent: app.vcpu }),
    sized({ label: 'Memory', spent: app.memory }),
    sized({ label: 'Volume', spent: app.volume }),
  ];

  const taken = measuredAt(resources.map((resource) => resource.measuredAt));

  return {
    lines: [
      `${app.slug}  ${APP_STATUS_LABELS[app.status]}`,
      // Under the status rather than in the table: `asleep` is only an answer beside the setting
      // that put it there, and neither is something the app is spending.
      activationSummary(app),
      '',
      ...resources.map((resource) =>
        `${resource.label.padEnd(LABEL_WIDTH)}  ${resource.spent}`.trimEnd(),
      ),
    ],
    measured: taken ? `measured at ${dayAndMinute(taken)}` : undefined,
  };
}

export const APP_STATUS_OUTPUT = defineOutput({
  schema: AppStatusSchema,
  render: ({ value, out }) => {
    const { lines, measured } = renderStatus(value);
    for (const line of lines) {
      out.info(line);
    }
    // Under the table and dimmed, because it qualifies every figure above rather than being one.
    if (measured) {
      out.info('');
      out.dim(measured);
    }
  },
});

export async function readStatus({
  api,
  slug,
}: {
  api: PublicApiClient;
  slug: string;
}): Promise<z.input<typeof AppStatusSchema>> {
  const { app, status } = await appWithStatus({ api, slug });
  const compute = app.computeUsage;
  const volume = app.volumeUsage;
  const { vcpuCount, memoryMib } = app.config.resources;
  // A share needs a rate behind it, so the first reading taken of a guest has none while the
  // memory it arrived with is already whole.
  const cpuShare = compute?.cpuShare;

  return {
    slug: app.slug,
    status: statusKey(status),
    activation: app.activation,
    idleTimeoutMs: app.idleTimeoutMs,
    vcpu: {
      used: cpuShare === undefined ? null : cpuShare * vcpuCount,
      total: vcpuCount,
      measuredAt: cpuShare === undefined ? null : (compute?.measuredAt ?? null),
    },
    memory: {
      used: compute?.memoryUsedBytes ?? null,
      total: memoryMib * BYTES_PER_MIB,
      measuredAt: compute?.measuredAt ?? null,
    },
    volume: {
      used: volume?.usedBytes ?? null,
      total: app.config.volumeSizeBytes,
      measuredAt: volume?.measuredAt ?? null,
    },
  };
}

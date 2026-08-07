import {
  type AppId,
  type DeploymentId,
  isValidMessage,
  type TenantLogRecord,
  TenantLogRecordSchema,
  type Timestamp,
} from '@repo/protocol';
import type { VictoriaLogsQuery } from '#lib/victorialogs/client.ts';
import type { LogRow } from '#lib/victorialogs/parse.ts';

/** The whole of what this repository asks of the store, so a test can be that and nothing more. */
export type TenantLogStore = { query: Pick<VictoriaLogsQuery, 'run'> };

export type TenantLogWindow = {
  appId: AppId;
  deploymentId: DeploymentId;
  /** Inclusive: the instant a reader resumes from. */
  since: Timestamp;
  /** Most records one read may answer with. Oldest first, so the rest are the next read's. */
  limit: number;
};

export abstract class LogsRepositoryContract {
  abstract read(input: TenantLogWindow): Promise<TenantLogRecord[]>;
}

/** Reads one deployment's tenant output back out of the log store. */
export class LogsRepository implements LogsRepositoryContract {
  private readonly store: TenantLogStore;

  constructor(store: TenantLogStore) {
    this.store = store;
  }

  async read({ appId, deploymentId, since, limit }: TenantLogWindow) {
    const rows = await this.store.query.run({
      query: tenantQuery({ appId, deploymentId, limit }),
      start: since,
    });
    return rows
      .map(toRecord)
      .filter((record) => record !== undefined)
      .sort(byWritingOrder);
  }
}

/**
 * The order a guest wrote its output in, which is the order it is read back in.
 *
 * `sort by (_time)` settles the instant and nothing within it, and a guest writes many lines inside
 * one millisecond — a program announcing itself at startup writes all of them there. How the store
 * holds those is the store's own business, and the order it hands them back in is not the order
 * they were written. `sequence` is: it counts what one source wrote, in order.
 *
 * Across sources it settles nothing, because two sources never share a counter — but a window read
 * twice has to come back the same way twice, so `sourceId` breaks that tie rather than the store.
 */
// biome-ignore lint/complexity/useMaxParams: a comparator compares two records
function byWritingOrder(left: TenantLogRecord, right: TenantLogRecord): number {
  if (left._time !== right._time) {
    return left._time < right._time ? -1 : 1;
  }
  if (left.sourceId !== right.sourceId) {
    return left.sourceId < right.sourceId ? -1 : 1;
  }
  return left.sequence - right.sequence;
}

/**
 * `SOURCE` and `appId` key the stream, so naming both is what narrows the search to one app's
 * streams before anything is read; `deploymentId` then filters within them. Values are quoted
 * even though identifiers cannot contain a LogsQL operator — the schema that says so is not this
 * file's, and a filter that only works because of a rule enforced elsewhere is one to write out.
 *
 * Sorted oldest first before the limit applies, so a window holding more than a reader asked for
 * is cut at its far end rather than its near one. The store's own `limit` keeps the newest
 * instead, which for something read forward from a cursor would skip everything in between.
 */
function tenantQuery({
  appId,
  deploymentId,
  limit,
}: Pick<TenantLogWindow, 'appId' | 'deploymentId' | 'limit'>): string {
  const filter = `SOURCE:=${quoted('tenant')} appId:=${quoted(appId)} deploymentId:=${quoted(deploymentId)}`;
  return `${filter} | sort by (_time) limit ${limit}`;
}

const quoted = (value: string) => JSON.stringify(value);

/**
 * The store keeps every field as a string, so the two numbers a record carries are read back as
 * text and have to be numbers again before the record is the shape the protocol declares.
 *
 * A record that then fails to validate is skipped rather than thrown: one malformed line must not
 * cost a reader the window it is in. `TenantLogRecordSchema` is what would catch a field renamed
 * on the writing side, so a read that suddenly yields nothing is that drift showing up.
 */
function toRecord(row: LogRow): TenantLogRecord | undefined {
  const value = {
    ...row,
    sequence: Number(row.sequence),
    ...(row.droppedBytes === undefined ? {} : { droppedBytes: Number(row.droppedBytes) }),
  };
  return isValidMessage({ schema: TenantLogRecordSchema, value })
    ? (value as TenantLogRecord)
    : undefined;
}

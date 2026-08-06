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
  signal: AbortSignal;
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

  async read({ appId, deploymentId, since, limit, signal }: TenantLogWindow) {
    const rows = await this.store.query.run({
      query: tenantQuery({ appId, deploymentId, limit }),
      start: since,
      signal,
    });
    return rows.map(toRecord).filter((record) => record !== undefined);
  }
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

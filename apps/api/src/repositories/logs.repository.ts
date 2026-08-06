import {
  type AppId,
  type DeploymentId,
  isValidMessage,
  type TenantLogRecord,
  TenantLogRecordSchema,
} from '@repo/protocol';
import type { VictoriaLogsTail } from '#lib/victorialogs/client.ts';
import type { LogRow } from '#lib/victorialogs/parse.ts';

/** The whole of what this repository asks of the store, so a test can be that and nothing more. */
export type TenantLogStore = { tail: Pick<VictoriaLogsTail, 'subscribe'> };

export type TenantLogTail = {
  appId: AppId;
  deploymentId: DeploymentId;
  /** How much history precedes the follow, as a LogsQL duration. */
  startOffset: string;
  signal: AbortSignal;
};

export abstract class LogsRepositoryContract {
  abstract tail(input: TenantLogTail): AsyncIterable<TenantLogRecord>;
}

/** Reads one deployment's tenant output back out of the log store. */
export class LogsRepository implements LogsRepositoryContract {
  private readonly store: TenantLogStore;

  constructor(store: TenantLogStore) {
    this.store = store;
  }

  async *tail({ appId, deploymentId, startOffset, signal }: TenantLogTail) {
    const rows = this.store.tail.subscribe({
      query: tenantQuery({ appId, deploymentId }),
      startOffset,
      signal,
    });
    for await (const row of rows) {
      const record = toRecord(row);
      if (record) {
        yield record;
      }
    }
  }
}

/**
 * `SOURCE` and `appId` key the stream, so naming both is what narrows the search to one app's
 * streams before anything is read; `deploymentId` then filters within them. Values are quoted
 * even though identifiers cannot contain a LogsQL operator — the schema that says so is not this
 * file's, and a filter that only works because of a rule enforced elsewhere is one to write out.
 */
function tenantQuery({
  appId,
  deploymentId,
}: {
  appId: AppId;
  deploymentId: DeploymentId;
}): string {
  return `SOURCE:=${quoted('tenant')} appId:=${quoted(appId)} deploymentId:=${quoted(deploymentId)}`;
}

const quoted = (value: string) => JSON.stringify(value);

/**
 * The store keeps every field as a string, so the two numbers a record carries are read back as
 * text and have to be numbers again before the record is the shape the protocol declares.
 *
 * A record that then fails to validate is skipped rather than thrown: a live tail must not end
 * because one line is malformed. `TenantLogRecordSchema` is what would catch a field renamed on
 * the writing side, so a tail that suddenly yields nothing is that drift showing up.
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

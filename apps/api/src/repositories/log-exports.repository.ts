import type { AppId, TenantLogRecord, Timestamp } from '@repo/protocol';
import type { VictoriaLogsExport } from '#lib/victorialogs/client.ts';
import { lines, toRow } from '#lib/victorialogs/parse.ts';
import { tenantRecordFromRow } from '#lib/victorialogs/tenant-record.ts';

export type LogExportInput = { appId: AppId; through: Timestamp; signal: AbortSignal };

export abstract class LogExportsRepositoryContract {
  abstract open(input: LogExportInput): Promise<AsyncIterable<TenantLogRecord>>;
}

export class LogExportsRepository implements LogExportsRepositoryContract {
  constructor(private readonly store: Pick<VictoriaLogsExport, 'open'>) {}

  async open({ appId, through, signal }: LogExportInput) {
    const body = await this.store.open({
      query: `SOURCE:=${JSON.stringify('tenant')} appId:=${JSON.stringify(appId)}`,
      end: through,
      signal,
    });
    return records({ body, appId });
  }
}

async function* records({ body, appId }: { body: ReadableStream<Uint8Array>; appId: AppId }) {
  for await (const line of lines(body)) {
    const row = toRow(line);
    const record = row ? tenantRecordFromRow(row) : undefined;
    if (!record || record.appId !== appId) {
      throw new Error('The log store returned an invalid app log record.');
    }
    yield record;
  }
}

import { isValidMessage, type TenantLogRecord, TenantLogRecordSchema } from '@repo/protocol';
import type { LogRow } from '#lib/victorialogs/parse.ts';

export function tenantRecordFromRow(row: LogRow): TenantLogRecord | undefined {
  const value = {
    ...row,
    sequence: Number(row.sequence),
    ...(row.droppedBytes === undefined ? {} : { droppedBytes: Number(row.droppedBytes) }),
  };
  return isValidMessage({ schema: TenantLogRecordSchema, value })
    ? (value as TenantLogRecord)
    : undefined;
}

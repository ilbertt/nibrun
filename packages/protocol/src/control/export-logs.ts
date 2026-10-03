import { Type } from '@sinclair/typebox';
import { ExportIdSchema } from '#domain/identifiers.ts';
import { TenantLogRecordSchema } from '#domain/log.ts';

export const ExportLogsRequestSchema = Type.Object({ exportId: ExportIdSchema });
export type ExportLogsRequest = typeof ExportLogsRequestSchema.static;

export const ExportLogEventSchema = Type.Union([
  Type.Object({ event: Type.Literal('log'), data: TenantLogRecordSchema }),
  Type.Object({ event: Type.Literal('complete'), data: Type.Object({}) }),
]);
export type ExportLogEvent = typeof ExportLogEventSchema.static;

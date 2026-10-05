import { Type } from '@sinclair/typebox';
import {
  AppIdSchema,
  CronJobIdSchema,
  CronRunIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
} from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

export const TENANT_LOG_STREAMS = ['stdout', 'stderr'] as const;
export const TenantLogStreamSchema = stringEnum(TENANT_LOG_STREAMS);
export type TenantLogStream = (typeof TENANT_LOG_STREAMS)[number];

const MAX_LOG_CHUNK_LENGTH = 65_536;
const MAX_SAFE_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;

// `_msg` and `_time` are the store's own names for a record's message and timestamp. Everything
// else is ours and stays camelCase.
export const TenantLogRecordSchema = Type.Object({
  _time: TimestampSchema,
  _msg: Type.String({ maxLength: MAX_LOG_CHUNK_LENGTH }),
  hostId: HostIdSchema,
  SOURCE: Type.Literal('tenant'),
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  stream: TenantLogStreamSchema,
  // Recreated with the host receiver. A gap in `sequence` within one `sourceId` means bounded
  // buffering dropped records; a new `sourceId` means the receiver itself restarted.
  sourceId: Type.String({ minLength: 1, maxLength: 64 }),
  sequence: Type.Integer({ minimum: 0, maximum: MAX_SAFE_WIRE_INTEGER }),
  cronJobId: Type.Optional(CronJobIdSchema),
  cronRunId: Type.Optional(CronRunIdSchema),
  droppedBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SAFE_WIRE_INTEGER })),
});

export type TenantLogRecord = typeof TenantLogRecordSchema.static;

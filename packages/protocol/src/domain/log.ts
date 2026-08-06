import { Type } from '@sinclair/typebox';
import { AppIdSchema, DeploymentIdSchema, HostIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

/**
 * Domain rather than control: a log record is not a message the agent sends the control plane.
 * The agent writes these to the log store and the api reads them back out of it, so the two never
 * exchange one — but a field renamed on the writing side and not the reading side would silently
 * stop matching, which is what keeps the shape here rather than in either app.
 */

export const TENANT_LOG_STREAMS = ['stdout', 'stderr'] as const;
export const TenantLogStreamSchema = stringEnum(TENANT_LOG_STREAMS);
export type TenantLogStream = (typeof TENANT_LOG_STREAMS)[number];

/**
 * Which component wrote a record, and the one field that answers it for the whole fleet.
 *
 * Uppercase, alone among our fields, because it is the only one two very different writers have
 * to agree on. The agent stamps it on tenant output; every other component on an app host reaches
 * the store through its journal, where systemd requires field names to be uppercase — so a
 * lowercase name here would mean `source:tenant` and `SOURCE:agent` were the same question asked
 * two ways, and a query would have to know which half of the fleet it was addressing first.
 */
export const LOG_SOURCES = ['tenant', 'agent', 'firecracker', 'zerofs', 'caddy'] as const;
export const LogSourceSchema = stringEnum(LOG_SOURCES);
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * The fields that identify a record's stream, and the only ones that may.
 *
 * The store indexes every field, so filtering on any of them is cheap — but these form the stream
 * key, and a stream is meant to be long-lived. Instance and deployment ids are deliberately
 * absent: they change on every deploy, so naming them here would mint a new stream per release
 * and never stop.
 */
export const LOG_STREAM_FIELDS = ['hostId', 'SOURCE', 'appId'] as const;

const MAX_LOG_CHUNK_LENGTH = 65_536;
const MAX_SAFE_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;

// `_msg` and `_time` are the store's own names for a record's message and timestamp. Everything
// else is ours and stays camelCase, like the rest of the protocol.
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
  droppedBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SAFE_WIRE_INTEGER })),
});

export type TenantLogRecord = typeof TenantLogRecordSchema.static;

/**
 * How much history a reader asks for before it starts following, as a duration such as `30s`.
 *
 * A duration rather than a number of lines, because the store is asked for a window of time and a
 * bound in rows is not one it could hold to. The pattern is exported beside the schema: a reader
 * whose validator is not TypeBox still has to refuse the same values this one does.
 */
export const LOG_TIMERANGE_PATTERN = '^[1-9][0-9]{0,3}[smh]$';

const MAX_LOG_TIMERANGE_LENGTH = 5;

export const LogTimerangeSchema = Type.String({
  description: 'How far back a log read starts, as a duration such as 30s, 5m or 2h.',
  pattern: LOG_TIMERANGE_PATTERN,
  maxLength: MAX_LOG_TIMERANGE_LENGTH,
});

export type LogTimerange = typeof LogTimerangeSchema.static;

export const DEFAULT_LOG_TIMERANGE = '5m';

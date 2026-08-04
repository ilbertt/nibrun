import { Type } from '@sinclair/typebox';
import { AppIdSchema, DeploymentIdSchema, InstanceIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

export const TENANT_LOG_STREAMS = ['stdout', 'stderr'] as const;
export const TenantLogStreamSchema = stringEnum(TENANT_LOG_STREAMS);
export type TenantLogStream = (typeof TENANT_LOG_STREAMS)[number];

const MAX_LOG_CHUNK_LENGTH = 65_536;
const MAX_SAFE_WIRE_INTEGER = Number.MAX_SAFE_INTEGER;

const TenantLogIdentitySchema = Type.Object({
  // Recreated with the host receiver. Sequence gaps inside one source mean bounded buffering
  // dropped events; a new source means the receiver itself restarted.
  sourceId: Type.String({ minLength: 1, maxLength: 64 }),
  sequence: Type.Integer({ minimum: 0, maximum: MAX_SAFE_WIRE_INTEGER }),
  observedAt: TimestampSchema,
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  instanceId: InstanceIdSchema,
});

export const TenantLogEventSchema = Type.Union([
  Type.Composite([
    TenantLogIdentitySchema,
    Type.Object({
      kind: Type.Literal('data'),
      stream: TenantLogStreamSchema,
      text: Type.String({ maxLength: MAX_LOG_CHUNK_LENGTH }),
    }),
  ]),
  Type.Composite([
    TenantLogIdentitySchema,
    Type.Object({
      kind: Type.Literal('gap'),
      droppedBytes: Type.Integer({ minimum: 1, maximum: MAX_SAFE_WIRE_INTEGER }),
    }),
  ]),
]);

export type TenantLogEvent = typeof TenantLogEventSchema.static;

export const TENANT_LOG_CONTENT_TYPE = 'application/x-ndjson';

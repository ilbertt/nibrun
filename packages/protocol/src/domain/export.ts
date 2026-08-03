import { Type } from '@sinclair/typebox';
import { AppIdSchema, CheckpointIdSchema, ExportIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, ObjectKeySchema, TimestampSchema } from '#lib/wire.ts';

export const EXPORT_STATES = ['pending', 'preparing', 'ready', 'failed', 'expired'] as const;

export const ExportStateSchema = stringEnum(EXPORT_STATES);

export type ExportState = typeof ExportStateSchema.static;

/**
 * A downloadable copy of an app — its binary plus its data.
 *
 * Not a backup: durability is the continuous path from the tenant filesystem to S3, and
 * nothing produces one of these on a schedule. The bundle carries the tenant's environment
 * variables and their entire dataset, so `expiresAt` is a security property rather than
 * housekeeping, and the bytes are only ever reachable through a short-lived presigned URL.
 */
export const ExportSchema = Type.Object({
  id: ExportIdSchema,
  appId: AppIdSchema,
  checkpointId: Type.Optional(CheckpointIdSchema),
  state: ExportStateSchema,
  objectKey: Type.Optional(ObjectKeySchema),
  sizeBytes: Type.Optional(ByteSizeSchema),
  requestedAt: TimestampSchema,
  readyAt: Type.Optional(TimestampSchema),
  expiresAt: Type.Optional(TimestampSchema),
});

export type Export = typeof ExportSchema.static;

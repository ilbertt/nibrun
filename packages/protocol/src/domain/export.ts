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
 *
 * **The host that owns the volume writes it, not the control plane.** It already has the
 * device attached, so it reads one tenant's filesystem and no other, in userspace and without
 * mounting it. The control plane then needs no access at all to tenant filesystems — only read
 * on the export bucket, which is what lets it sign a download URL.
 *
 * `checkpointId` names the pinned view the bundle was read from, and is the export's own: cut
 * while the tenant was frozen and deleted as soon as the read finished, because a checkpoint
 * left behind stops garbage collection for every tenant on that host. So it says which moment
 * the bundle is of rather than where to find one — by the time it is reported it is gone.
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

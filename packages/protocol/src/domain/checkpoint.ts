import { Type } from '@sinclair/typebox';
import { CheckpointIdSchema, VolumeIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

const MAX_CHECKPOINT_REFERENCE_LENGTH = 512;

export const CHECKPOINT_STATES = ['pending', 'ready', 'failed'] as const;

export const CheckpointStateSchema = stringEnum(CHECKPOINT_STATES);

export type CheckpointState = typeof CheckpointStateSchema.static;

/**
 * A point-in-time view of a volume, cut by the host that currently has it open.
 *
 * Export reads a tenant's filesystem from S3 while a host still has it open read-write, so it
 * needs a view that is not moving underneath it. The host is the only party that can produce
 * one, which is why cutting a checkpoint is expressed as desired state rather than as
 * something the exporter does for itself.
 *
 * `reference` is whatever the storage layer hands back to address the checkpoint afterwards,
 * kept opaque here so that its shape stays the storage layer's business.
 */
export const CheckpointSchema = Type.Object({
  id: CheckpointIdSchema,
  volumeId: VolumeIdSchema,
  state: CheckpointStateSchema,
  reference: Type.Optional(Type.String({ maxLength: MAX_CHECKPOINT_REFERENCE_LENGTH })),
  createdAt: TimestampSchema,
  readyAt: Type.Optional(TimestampSchema),
});

export type Checkpoint = typeof CheckpointSchema.static;

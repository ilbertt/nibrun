import { Type } from '@sinclair/typebox';
import { CheckpointIdSchema, VolumeIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { TimestampSchema } from '#lib/wire.ts';

const MAX_CHECKPOINT_REFERENCE_LENGTH = 512;

export const CHECKPOINT_STATES = ['pending', 'ready', 'failed'] as const;

export const CheckpointStateSchema = stringEnum(CHECKPOINT_STATES);

export type CheckpointState = typeof CheckpointStateSchema.static;

/**
 * A pinned, non-advancing view of a volume, cut by the host that currently has it open.
 *
 * Export does **not** need one: the owning host writes the export itself, from the device it
 * already has attached, so there is no second reader to give a consistent view to.
 *
 * A checkpoint is for the case a live view cannot serve: an image that must stay still across
 * a long operation, such as a migration. That is the only reason this is expressible as
 * desired state — the owning host is the only party that can cut one.
 *
 * Checkpoints never expire, and pin the storage they reference against garbage collection
 * until deleted. Removing one is the point of `absent`, not an afterthought.
 *
 * `reference` is whatever the storage layer hands back to address it afterwards, kept opaque
 * so its shape stays the storage layer's business.
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

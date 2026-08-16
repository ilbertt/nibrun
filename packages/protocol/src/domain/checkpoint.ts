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
 * Export needs one. The bundle is read by a second, read-only server rather than off the live
 * device, and that second reader is exactly what a checkpoint exists to give a consistent view
 * to. It is what shortens the tenant's freeze from the whole read to the cut, without the bundle
 * becoming any staler: the checkpoint is taken while the guest is still frozen, so it pins the
 * same moment the freeze does.
 *
 * The other case is an image that must stay still across a long operation, such as a migration.
 * Either way the owning host is the only party that can cut one, which is why this is expressible
 * as desired state at all.
 *
 * Checkpoints never expire, and pin the storage they reference against garbage collection until
 * deleted — segment deletion, segment compaction and metadata reclamation all stop while any
 * checkpoint exists, for every volume that host serves rather than only the one it was cut from.
 * Removing one is the point of `absent`, not an afterthought.
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

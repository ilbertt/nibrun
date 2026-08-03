import { Type } from '@sinclair/typebox';
import { AppConfigSchema, AppHostnameSchema } from '#domain/app.ts';
import {
  AppIdSchema,
  CheckpointIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  InstanceIdSchema,
  VolumeIdSchema,
} from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, ObjectKeySchema, Sha256DigestSchema } from '#lib/wire.ts';

// What a host should be running. There is deliberately nothing here shaped like `start(x)` or
// `stop(x)`: the control plane describes a world and the agent converges on it, so a missed
// message, an agent restart and a control-plane restart are all non-events — the next poll
// re-reads the truth.

export const DESIRED_INSTANCE_STATES = ['running', 'stopped'] as const;

export const DesiredInstanceStateSchema = stringEnum(DESIRED_INSTANCE_STATES);

export type DesiredInstanceState = typeof DesiredInstanceStateSchema.static;

export const DESIRED_PRESENCE = ['present', 'absent'] as const;

export const DesiredPresenceSchema = stringEnum(DESIRED_PRESENCE);

export type DesiredPresence = typeof DesiredPresenceSchema.static;

export const DesiredArtifactSchema = Type.Object({
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  objectKey: ObjectKeySchema,
});

export type DesiredArtifact = typeof DesiredArtifactSchema.static;

export const DesiredInstanceSchema = Type.Object({
  instanceId: InstanceIdSchema,
  appId: AppIdSchema,
  deploymentId: DeploymentIdSchema,
  volumeId: VolumeIdSchema,
  desiredState: DesiredInstanceStateSchema,
  artifact: DesiredArtifactSchema,
  config: AppConfigSchema,
  // Carried down so the host can render its own routing config from the same state it boots
  // VMs with. The process that knows what is running is the process that writes the routing
  // config, which is what leaves no room for the two to drift.
  hostnames: Type.Array(AppHostnameSchema),
});

export type DesiredInstance = typeof DesiredInstanceSchema.static;

export const DesiredVolumeSchema = Type.Object({
  volumeId: VolumeIdSchema,
  appId: AppIdSchema,
  sizeBytes: ByteSizeSchema,
  storagePrefix: ObjectKeySchema,
  desiredState: DesiredPresenceSchema,
});

export type DesiredVolume = typeof DesiredVolumeSchema.static;

export const DesiredCheckpointSchema = Type.Object({
  checkpointId: CheckpointIdSchema,
  volumeId: VolumeIdSchema,
  desiredState: DesiredPresenceSchema,
});

export type DesiredCheckpoint = typeof DesiredCheckpointSchema.static;

/**
 * The whole of what one host should be doing.
 *
 * `instances` is authoritative: a microVM running on the host and absent from this list is one
 * the host stops and forgets. `volumes` and `checkpoints` are not — they hold tenant data, so
 * removing one is only ever expressed by an explicit `absent`, never implied by a list
 * shrinking. A truncated response must not be able to delete a filesystem.
 *
 * `generation` increases whenever anything below it changes, and is what the agent long-polls
 * against and echoes back as `observedGeneration`.
 */
export const HostDesiredStateSchema = Type.Object({
  hostId: HostIdSchema,
  generation: Type.Integer({ minimum: 0 }),
  volumes: Type.Array(DesiredVolumeSchema),
  instances: Type.Array(DesiredInstanceSchema),
  checkpoints: Type.Array(DesiredCheckpointSchema),
});

export type HostDesiredState = typeof HostDesiredStateSchema.static;

import { Type } from '@sinclair/typebox';
import { AppConfigSchema, AppHostnameSchema } from '#domain/app.ts';
import {
  AppIdSchema,
  CheckpointIdSchema,
  DeploymentIdSchema,
  ExportIdSchema,
  HostIdSchema,
  InstanceIdSchema,
  VolumeIdSchema,
} from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, FilenameSchema, ObjectKeySchema, Sha256DigestSchema } from '#lib/wire.ts';

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

/**
 * `filename` is what the uploader called the binary, and it exists because `objectKey` cannot
 * answer that: keys are assigned to avoid collisions, so they carry no name. Nothing on the
 * host boots from it — the guest execs a fixed path by boot contract — and its only use is the
 * name the binary takes inside an export, which is the one place a person sees it again.
 *
 * Required, because an upload nobody has completed is not deployable: by the time an artifact
 * appears here it has been named, so there is no nameless case for a host to handle.
 */
export const DesiredArtifactSchema = Type.Object({
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  objectKey: ObjectKeySchema,
  filename: FilenameSchema,
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
 * A bundle the owning host should write, because it is the only party that can.
 *
 * The host has the tenant's device attached already, so it reads that one filesystem and no
 * other, in userspace and without mounting it. Asking the control plane to do it would mean
 * giving it access to tenant filesystems, and under a per-host storage layout that means access
 * to *every* tenant's, to serve one.
 *
 * `objectKey` is chosen by the control plane rather than the host: it is what the download URL
 * is signed against, and a key the control plane did not choose is one it would have to be told
 * before it could sign anything.
 *
 * `artifact` is carried here rather than joined from `instances`, because the moment an owner
 * most wants their data out is after they have stopped the app — and a stopped app has no
 * instance to take a binary from. Which binary belongs in the bundle is a fact the control
 * plane holds either way, so asking the host to infer it only made it inferrable less often.
 */
export const DesiredExportSchema = Type.Object({
  exportId: ExportIdSchema,
  appId: AppIdSchema,
  volumeId: VolumeIdSchema,
  objectKey: ObjectKeySchema,
  artifact: DesiredArtifactSchema,
  desiredState: DesiredPresenceSchema,
});

export type DesiredExport = typeof DesiredExportSchema.static;

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
  exports: Type.Array(DesiredExportSchema),
});

export type HostDesiredState = typeof HostDesiredStateSchema.static;

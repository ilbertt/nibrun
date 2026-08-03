import { Type } from '@sinclair/typebox';
import { CheckpointStateSchema } from '#domain/checkpoint.ts';
import { HostCapacitySchema, HostStateSchema, HostVersionsSchema } from '#domain/host.ts';
import {
  CheckpointIdSchema,
  DeploymentIdSchema,
  HostIdSchema,
  InstanceIdSchema,
  VolumeIdSchema,
} from '#domain/identifiers.ts';
import { InstanceStateSchema } from '#domain/instance.ts';
import { VolumeStateSchema } from '#domain/volume.ts';
import {
  ByteSizeSchema,
  HostPortSchema,
  Ipv4AddressSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '#lib/wire.ts';

const MAX_MESSAGE_LENGTH = 512;
const MAX_DEVICE_PATH_LENGTH = 256;

// Operator-facing detail about why something is in the state it is in. Never the tenant's own
// output: that goes to the guest console, which systemd captures into the host's journal, and
// it must not arrive here where it would end up in the control plane's database.
const MessageSchema = Type.String({ maxLength: MAX_MESSAGE_LENGTH });

export const ReportedInstanceSchema = Type.Object({
  instanceId: InstanceIdSchema,
  deploymentId: DeploymentIdSchema,
  state: InstanceStateSchema,
  // Reported even though routing is local to the host: the control plane needs it to debug a
  // host it cannot connect to, and it is what a second app host would route on.
  hostPort: Type.Optional(HostPortSchema),
  guestIpv4: Type.Optional(Ipv4AddressSchema),
  artifactDigest: Type.Optional(Sha256DigestSchema),
  restartCount: Type.Integer({ minimum: 0 }),
  startedAt: Type.Optional(TimestampSchema),
  lastHealthyAt: Type.Optional(TimestampSchema),
  lastExitCode: Type.Optional(Type.Integer()),
  message: Type.Optional(MessageSchema),
});

export type ReportedInstance = typeof ReportedInstanceSchema.static;

export const ReportedVolumeSchema = Type.Object({
  volumeId: VolumeIdSchema,
  state: VolumeStateSchema,
  sizeBytes: ByteSizeSchema,
  devicePath: Type.Optional(Type.String({ maxLength: MAX_DEVICE_PATH_LENGTH })),
  message: Type.Optional(MessageSchema),
});

export type ReportedVolume = typeof ReportedVolumeSchema.static;

export const ReportedCheckpointSchema = Type.Object({
  checkpointId: CheckpointIdSchema,
  volumeId: VolumeIdSchema,
  state: CheckpointStateSchema,
  reference: Type.Optional(MessageSchema),
  readyAt: Type.Optional(TimestampSchema),
  message: Type.Optional(MessageSchema),
});

export type ReportedCheckpoint = typeof ReportedCheckpointSchema.static;

/**
 * What a host is actually doing, as observed by the agent — not as the agent remembers having
 * arranged. On startup the agent enumerates what is really running before it reports, so a
 * restarted agent converges against reality rather than assuming it began from nothing.
 *
 * `observedGeneration` is the desired-state generation this report reflects, which is how the
 * control plane tells "converged" from "has not read the new state yet".
 */
export const HostReportedStateSchema = Type.Object({
  hostId: HostIdSchema,
  observedGeneration: Type.Integer({ minimum: 0 }),
  reportedAt: TimestampSchema,
  state: HostStateSchema,
  capacity: HostCapacitySchema,
  allocatable: HostCapacitySchema,
  versions: HostVersionsSchema,
  volumes: Type.Array(ReportedVolumeSchema),
  instances: Type.Array(ReportedInstanceSchema),
  checkpoints: Type.Array(ReportedCheckpointSchema),
});

export type HostReportedState = typeof HostReportedStateSchema.static;

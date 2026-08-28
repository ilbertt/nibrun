import { Type } from '@sinclair/typebox';
import { CheckpointStateSchema } from '#domain/checkpoint.ts';
import { ExportStateSchema } from '#domain/export.ts';
import { FilesystemUsageSchema } from '#domain/filesystem.ts';
import { HostCapacitySchema, HostStateSchema, HostVersionsSchema } from '#domain/host.ts';
import {
  AppIdSchema,
  CheckpointIdSchema,
  DeploymentIdSchema,
  ExportIdSchema,
  HostIdSchema,
  VolumeIdSchema,
} from '#domain/identifiers.ts';
import { InstanceStateSchema } from '#domain/instance.ts';
import { VolumeStateSchema } from '#domain/volume.ts';
import {
  ByteSizeSchema,
  HostPortSchema,
  Ipv4AddressSchema,
  ObjectKeySchema,
  Sha256DigestSchema,
  StateMessageSchema,
  TimestampSchema,
} from '#lib/wire.ts';

const MAX_DEVICE_PATH_LENGTH = 256;

export const ReportedInstanceSchema = Type.Object({
  appId: AppIdSchema,
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
  message: Type.Optional(StateMessageSchema),
});

export type ReportedInstance = typeof ReportedInstanceSchema.static;

export const ReportedVolumeSchema = Type.Object({
  volumeId: VolumeIdSchema,
  appId: AppIdSchema,
  state: VolumeStateSchema,
  sizeBytes: ByteSizeSchema,
  // Which ZeroFS filesystem the host put it in.
  storagePrefix: Type.Optional(ObjectKeySchema),
  devicePath: Type.Optional(Type.String({ maxLength: MAX_DEVICE_PATH_LENGTH })),
  /**
   * How full the filesystem on it is, which only the guest holding it mounted can say — so it
   * rides the report the host was sending anyway rather than being asked for. Absent while no
   * guest has answered: a volume nothing has mounted has a size and no reading, and a zero here
   * would be a filesystem somebody had just emptied.
   */
  usage: Type.Optional(FilesystemUsageSchema),
  message: Type.Optional(StateMessageSchema),
});

export type ReportedVolume = typeof ReportedVolumeSchema.static;

export const ReportedCheckpointSchema = Type.Object({
  checkpointId: CheckpointIdSchema,
  volumeId: VolumeIdSchema,
  state: CheckpointStateSchema,
  reference: Type.Optional(StateMessageSchema),
  readyAt: Type.Optional(TimestampSchema),
  message: Type.Optional(StateMessageSchema),
});

export type ReportedCheckpoint = typeof ReportedCheckpointSchema.static;

// The host reports the size it wrote but not where it put it: the key came down in desired
// state, so echoing it back would be a second place for it to be wrong. `checkpointId` goes the
// other way for the same reason — the host names the view it read from, and being told is the
// only way this end learns which moment the bundle is of.
export const ReportedExportSchema = Type.Object({
  exportId: ExportIdSchema,
  checkpointId: Type.Optional(CheckpointIdSchema),
  state: ExportStateSchema,
  sizeBytes: Type.Optional(ByteSizeSchema),
  readyAt: Type.Optional(TimestampSchema),
  message: Type.Optional(StateMessageSchema),
});

export type ReportedExport = typeof ReportedExportSchema.static;

/**
 * What a host is actually doing, as observed by the agent — not as the agent remembers having
 * arranged. On startup the agent enumerates what is really running before it reports, so a
 * restarted agent converges against reality rather than assuming it began from nothing.
 *
 * Converged is read from the contents rather than from a version number the host echoes: the
 * deployment an instance names is what the control plane was waiting to see, and it says which
 * release arrived rather than only that some state did.
 */
export const HostReportedStateSchema = Type.Object({
  hostId: HostIdSchema,
  reportedAt: TimestampSchema,
  state: HostStateSchema,
  capacity: HostCapacitySchema,
  allocatable: HostCapacitySchema,
  versions: HostVersionsSchema,
  volumes: Type.Array(ReportedVolumeSchema),
  instances: Type.Array(ReportedInstanceSchema),
  checkpoints: Type.Array(ReportedCheckpointSchema),
  exports: Type.Array(ReportedExportSchema),
});

export type HostReportedState = typeof HostReportedStateSchema.static;

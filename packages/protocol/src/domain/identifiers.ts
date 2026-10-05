import { type Identifier, identifierSchema } from '#lib/wire.ts';

// Also the microVM's: an app runs one, so the two never differ and a second id for it would be
// the same value under another name.
export type AppId = Identifier<'AppId'>;
export const AppIdSchema = identifierSchema<AppId>('A tenant app, and the microVM running it.');
export type DeploymentId = Identifier<'DeploymentId'>;

export const DeploymentIdSchema = identifierSchema<DeploymentId>(
  'One artifact plus the configuration it was launched with.',
);

export type CronJobId = Identifier<'CronJobId'>;
export const CronJobIdSchema = identifierSchema<CronJobId>('One registered cron job.');
export type CronQueryId = Identifier<'CronQueryId'>;
export const CronQueryIdSchema = identifierSchema<CronQueryId>('One live cron listing request.');
export type HostId = Identifier<'HostId'>;
export const HostIdSchema = identifierSchema<HostId>('One app host.');
export type VolumeId = Identifier<'VolumeId'>;
export const VolumeIdSchema = identifierSchema<VolumeId>("An app's persistent filesystem.");
export type CheckpointId = Identifier<'CheckpointId'>;

export const CheckpointIdSchema = identifierSchema<CheckpointId>(
  'A point-in-time view of a volume, readable while the owning host still has it open.',
);

export type ExportId = Identifier<'ExportId'>;

export const ExportIdSchema = identifierSchema<ExportId>(
  'One request for a downloadable copy of an app.',
);

export type FilesystemQueryId = Identifier<'FilesystemQueryId'>;

export const FilesystemQueryIdSchema = identifierSchema<FilesystemQueryId>(
  'One read of one directory, alive only while its answer is still awaited.',
);

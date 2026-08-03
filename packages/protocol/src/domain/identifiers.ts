import { type Identifier, identifierSchema } from '#lib/wire.ts';

// Branded apart so that passing one entity's id where another's belongs is a type error.
// They are all opaque strings on the wire; nothing in this package interprets their contents.

export type OwnerId = Identifier<'OwnerId'>;
export const OwnerIdSchema = identifierSchema<OwnerId>('The account an app belongs to.');

export type AppId = Identifier<'AppId'>;
export const AppIdSchema = identifierSchema<AppId>('A tenant app.');

export type ArtifactId = Identifier<'ArtifactId'>;
export const ArtifactIdSchema = identifierSchema<ArtifactId>('One uploaded binary.');

export type DeploymentId = Identifier<'DeploymentId'>;
export const DeploymentIdSchema = identifierSchema<DeploymentId>(
  'One artifact plus the configuration it was launched with.',
);

export type InstanceId = Identifier<'InstanceId'>;
export const InstanceIdSchema = identifierSchema<InstanceId>('One microVM of one deployment.');

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

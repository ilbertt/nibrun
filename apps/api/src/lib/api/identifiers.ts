import { type Identifier, identifierSchema } from '@repo/protocol';

// Branded apart so that passing one entity's id where another's belongs is a type error.
// They are all opaque strings on the wire; nothing in this package interprets their contents.

export type OwnerId = Identifier<'OwnerId'>;
export const OwnerIdSchema = identifierSchema<OwnerId>('The account an app belongs to.');
export type ArtifactId = Identifier<'ArtifactId'>;
export const ArtifactIdSchema = identifierSchema<ArtifactId>('One uploaded binary.');
export type DeployKeyId = Identifier<'DeployKeyId'>;
export const DeployKeyIdSchema = identifierSchema<DeployKeyId>('One app-scoped SSH deploy key.');
export type ImportId = Identifier<'ImportId'>;

export const ImportIdSchema = identifierSchema<ImportId>(
  'One uploaded archive an app can be given as its starting data.',
);

export type SqliteConnectionId = Identifier<'SqliteConnectionId'>;
export const SqliteConnectionIdSchema = identifierSchema<SqliteConnectionId>(
  'One saved database connection.',
);

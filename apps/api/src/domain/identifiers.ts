import { type Identifier, identifierSchema } from '@repo/protocol';

// Branded apart so that passing one entity's id where another's belongs is a type error.
// They are all opaque strings on the wire; nothing in this package interprets their contents.

export type OwnerId = Identifier<'OwnerId'>;
export const OwnerIdSchema = identifierSchema<OwnerId>('The account an app belongs to.');
export type ArtifactId = Identifier<'ArtifactId'>;
export const ArtifactIdSchema = identifierSchema<ArtifactId>('One uploaded binary.');
export type CronRunId = Identifier<'CronRunId'>;
export const CronRunIdSchema = identifierSchema<CronRunId>('One execution of a cron job.');
export type ImportId = Identifier<'ImportId'>;

export const ImportIdSchema = identifierSchema<ImportId>(
  'One uploaded archive an app can be given as its starting data.',
);

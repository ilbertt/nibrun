import { type Identifier, identifierSchema } from '@repo/protocol';
import type { Brand, BrandedSchema } from '@repo/typebox-extensions';
import { type TString, Type } from '@sinclair/typebox';

// Branded apart so that passing one entity's id where another's belongs is a type error.
// They are all opaque strings on the wire; nothing in this package interprets their contents.

export type OwnerId = Identifier<'OwnerId'>;
export const OwnerIdSchema = identifierSchema<OwnerId>('The account an app belongs to.');
export type ArtifactId = Identifier<'ArtifactId'>;
export const ArtifactIdSchema = identifierSchema<ArtifactId>('One uploaded binary.');
export type ImportId = Identifier<'ImportId'>;

export const ImportIdSchema = identifierSchema<ImportId>(
  'One uploaded archive an app can be given as its starting data.',
);

export type SqliteConnectionId = Identifier<'SqliteConnectionId'>;
export const SqliteConnectionIdSchema = identifierSchema<SqliteConnectionId>(
  'One saved database connection.',
);

export type TrustedWorkflowId = Identifier<'TrustedWorkflowId'>;
export const TrustedWorkflowIdSchema = identifierSchema<TrustedWorkflowId>(
  'One trusted GitHub deployment workflow.',
);

export type DeploymentGrantId = Identifier<'DeploymentGrantId'>;
export const DeploymentGrantIdSchema = identifierSchema<DeploymentGrantId>(
  'One short-lived deployment authorization.',
);

export type OAuthClientId = Brand<string, 'OAuthClientId'>;
export const OAuthClientIdSchema = Type.String({
  minLength: 1,
  description: 'An OAuth client ID, including a CIMD metadata URL.',
}) as BrandedSchema<TString, OAuthClientId>;

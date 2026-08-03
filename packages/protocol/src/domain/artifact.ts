import { Type } from '@sinclair/typebox';
import { AppIdSchema, ArtifactIdSchema } from '#domain/identifiers.ts';
import { stringEnum } from '#lib/string-enum.ts';
import { ByteSizeSchema, ObjectKeySchema, Sha256DigestSchema, TimestampSchema } from '#lib/wire.ts';

export const ARTIFACT_STATES = ['pending', 'available', 'failed'] as const;

export const ArtifactStateSchema = stringEnum(ARTIFACT_STATES);

export type ArtifactState = typeof ArtifactStateSchema.static;

// The digest is what the agent verifies after pulling, so it is the artifact's identity as
// far as a host is concerned; the key is only where to find the bytes.
export const ArtifactSchema = Type.Object({
  id: ArtifactIdSchema,
  appId: AppIdSchema,
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  objectKey: ObjectKeySchema,
  state: ArtifactStateSchema,
  createdAt: TimestampSchema,
});

export type Artifact = typeof ArtifactSchema.static;

import {
  AppIdSchema,
  ByteSizeSchema,
  FilenameSchema,
  ObjectKeySchema,
  OciImageSchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '@repo/protocol';
import { Type } from '@sinclair/typebox';
import { ArtifactIdSchema } from '#lib/api/identifiers.ts';

// The digest is what the agent verifies after pulling, so it is the artifact's identity as
// far as a host is concerned; the key is only where to find the bytes.
//
// No state: the row is written once the bytes are stored, so an artifact that exists is one
// that can be deployed.
export const BinaryArtifactSchema = Type.Object({
  id: ArtifactIdSchema,
  appId: AppIdSchema,
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  objectKey: ObjectKeySchema,
  // Kept because the key cannot answer it: keys are content-addressed, so they carry no name.
  // It is what the binary is called inside an export, which is where a person meets it again.
  originalFileName: FilenameSchema,
  originalFileUrl: Type.Optional(
    Type.String({ description: 'Original download URL, absent for uploaded binaries.' }),
  ),
  createdAt: TimestampSchema,
});

export type BinaryArtifact = typeof BinaryArtifactSchema.static;

export const ImageArtifactSchema = Type.Object({
  ...Type.Pick(BinaryArtifactSchema, ['id', 'appId', 'createdAt']).properties,
  ...OciImageSchema.properties,
});
export type ImageArtifact = typeof ImageArtifactSchema.static;

export const ArtifactSchema = Type.Union([BinaryArtifactSchema, ImageArtifactSchema]);
export type Artifact = typeof ArtifactSchema.static;

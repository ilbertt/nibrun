import { Type } from '@sinclair/typebox';
import { AppIdSchema, ArtifactIdSchema } from '#domain/identifiers.ts';
import {
  ByteSizeSchema,
  FilenameSchema,
  ObjectKeySchema,
  Sha256DigestSchema,
  TimestampSchema,
} from '#lib/wire.ts';

// The digest is what the agent verifies after pulling, so it is the artifact's identity as
// far as a host is concerned; the key is only where to find the bytes.
//
// No state: the row is written once the bytes are stored, so an artifact that exists is one
// that can be deployed.
export const ArtifactSchema = Type.Object({
  id: ArtifactIdSchema,
  appId: AppIdSchema,
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  objectKey: ObjectKeySchema,
  // Kept because the key cannot answer it: keys are content-addressed, so they carry no name.
  // It is what the binary is called inside an export, which is where a person meets it again.
  originalFileName: FilenameSchema,
  createdAt: TimestampSchema,
});

export type Artifact = typeof ArtifactSchema.static;

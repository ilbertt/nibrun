import { Type } from '@sinclair/typebox';
import { AppIdSchema, ImportIdSchema } from '#domain/identifiers.ts';
import { ByteSizeSchema, FilenameSchema, Sha256DigestSchema, TimestampSchema } from '#lib/wire.ts';

// An archive an owner uploaded, which an app's filesystem can be created holding. A noun with no
// notion of use: what it is for is said by whatever names it, exactly as a deployment says which
// binary to run by naming an artifact.
//
// The digest is what the host verifies after pulling, so it is the archive's identity as far as
// one is concerned.
//
// Where the bytes are is deliberately absent, unlike an artifact's: an owner cannot read that key
// and has no use for one, the api is the only thing that ever resolves it, and it stops naming
// anything the moment the archive has been used.
//
// No state: the row is what an upload is addressed by, and one that appears here has had its bytes
// read back and hashed.
export const ImportSchema = Type.Object({
  id: ImportIdSchema,
  appId: AppIdSchema,
  digest: Sha256DigestSchema,
  sizeBytes: ByteSizeSchema,
  // The only name anybody would recognise the archive by: nothing else here carries one.
  originalFileName: FilenameSchema,
  createdAt: TimestampSchema,
});

export type Import = typeof ImportSchema.static;

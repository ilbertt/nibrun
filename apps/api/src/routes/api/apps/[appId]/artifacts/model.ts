import { ArtifactIdSchema, ArtifactSchema, ByteSizeSchema, FilenameSchema } from '@repo/protocol';
import { t } from 'elysia';

// The name is the caller's, not the store's: a content-addressed key carries none, and this is
// what a host writes into an export archive. Refused here as a shape rather than sanitised into
// a different name — see FilenameSchema.
//
// The size is only a claim, answered before anything is signed. What holds the upload to it is
// the policy in the response.
export const CreateArtifactBodySchema = t.Object({
  filename: FilenameSchema,
  sizeBytes: ByteSizeSchema,
});

export const CreateArtifactResponseSchema = t.Object({
  artifactId: ArtifactIdSchema,
  url: t.String({ description: 'Where to post the binary.' }),
  fields: t.Record(t.String(), t.String(), {
    description: 'Form fields to send before the file, which must be the last part.',
  }),
});

// Said by the only end that knows: the upload happened between the caller and the store, so the
// api learns how it went by being told.
export const UpdateArtifactBodySchema = t.Object({
  upload: t.Union([t.Literal('complete'), t.Literal('failed')]),
});

export const ListArtifactsResponseSchema = t.Object({
  artifacts: t.Array(ArtifactSchema),
});

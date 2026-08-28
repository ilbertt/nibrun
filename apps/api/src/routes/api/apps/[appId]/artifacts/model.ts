import { ArtifactIdSchema, ArtifactSchema, ByteSizeSchema, FilenameSchema } from '@repo/protocol';
import { t } from 'elysia';
import { BINARY_URL_PATTERN, MAX_BINARY_URL_LENGTH } from '#lib/binary-url.ts';

// The bytes the caller holds. The name is theirs, not the store's: a content-addressed key carries
// none, and this is what a host writes into an export archive. Refused here as a shape rather than
// sanitised into a different name — see FilenameSchema.
//
// The size is answered before anything is signed, and then signed into the url: the store holds
// the upload to exactly it.
const UploadedBinarySchema = t.Object({
  filename: FilenameSchema,
  sizeBytes: ByteSizeSchema,
});

// Bytes the caller does not hold: no name and no size, because the api is the one fetching and so
// the one that finds out how large the binary is and what the file at the end of the url is called.
const FetchedBinarySchema = t.Object({
  url: t.String({
    description: 'Public https url the api fetches the binary from.',
    pattern: BINARY_URL_PATTERN,
    maxLength: MAX_BINARY_URL_LENGTH,
  }),
});

// Where the binary is, however that is answered. One request either way: what differs is who ends
// up moving the bytes, which is not a different thing to have asked for.
export const CreateArtifactBodySchema = t.Union([UploadedBinarySchema, FetchedBinarySchema]);

const StagedUploadSchema = t.Object({
  artifactId: ArtifactIdSchema,
  url: t.String({ description: 'Where to PUT the binary, as the whole request body.' }),
});

// Somewhere to send bytes, or the artifact those bytes already made. A caller knows which it is
// owed by what it asked for, and `digest` is what tells them apart in the hand.
export const CreateArtifactResponseSchema = t.Union([StagedUploadSchema, ArtifactSchema]);

// Said by the only end that knows: the upload happened between the caller and the store, so the
// api learns how it went by being told.
export const UpdateArtifactBodySchema = t.Object({
  upload: t.Union([t.Literal('complete'), t.Literal('failed')]),
});

export const ListArtifactsResponseSchema = t.Object({
  artifacts: t.Array(ArtifactSchema),
});

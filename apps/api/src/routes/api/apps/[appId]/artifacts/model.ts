import { ByteSizeSchema, FilenameSchema, OciImageSchema, Sha256DigestSchema } from '@repo/protocol';
import { t } from 'elysia';
import { ArtifactSchema } from '#lib/api/artifact.ts';
import { ArtifactIdSchema } from '#lib/api/identifiers.ts';
import { remoteUrlSchema } from '#lib/remote-url.ts';

// The bytes the caller holds. The name is theirs, not the store's: a content-addressed key carries
// none, and this is what a host writes into an export archive. Refused here as a shape rather than
// sanitised into a different name — see FilenameSchema.
//
// The size is answered before anything is signed, and then signed into the url: the store holds
// the upload to exactly it.
const UploadedBinarySchema = t.Object(
  {
    filename: FilenameSchema,
    sizeBytes: ByteSizeSchema,
  },
  { additionalProperties: false },
);

// Bytes the caller does not hold: no name and no size, because the api is the one fetching and so
// the one that finds out how large the binary is and what the file at the end of the url is called.
//
// The digest is the one thing about them a caller can know before the fetch, and the only one this
// end will take their word about — as an expectation to hold the download to rather than as a fact
// about it. Over the file the url serves, which for an archive is the archive: that is what a
// release publishes a checksum for, and the only form one is ever written down in.
const FetchedBinarySchema = t.Object(
  {
    url: remoteUrlSchema('Public HTTPS URL the API fetches the binary from.'),
    sha256: t.Optional(Sha256DigestSchema),
  },
  { additionalProperties: false },
);

// Where the binary is, however that is answered. One request either way: what differs is who ends
// up moving the bytes, which is not a different thing to have asked for.
export const CreateArtifactBodySchema = t.Union([
  UploadedBinarySchema,
  FetchedBinarySchema,
  t.Object({ image: OciImageSchema }, { additionalProperties: false }),
]);

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

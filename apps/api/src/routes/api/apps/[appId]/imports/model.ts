import { ByteSizeSchema, FilenameSchema, Sha256DigestSchema } from '@repo/protocol';
import { t } from 'elysia';
import { ImportIdSchema } from '#lib/api/identifiers.ts';
import { ImportSchema } from '#lib/api/import.ts';
import { MAX_REMOTE_URL_LENGTH, REMOTE_URL_PATTERN } from '#lib/remote-url.ts';

// The bytes the owner holds. The name is theirs, not the store's: keys here are assigned one per
// row, so they carry none, and this is the only name anybody would recognise the archive by.
//
// The size is answered before anything is signed, and then signed into the url: the store holds
// the upload to exactly it.
const UploadedArchiveSchema = t.Object({
  filename: FilenameSchema,
  sizeBytes: ByteSizeSchema,
});

const StagedUploadSchema = t.Object({
  importId: ImportIdSchema,
  url: t.String({ description: 'Where to PUT the archive, as the whole request body.' }),
});

const FetchedArchiveSchema = t.Object({
  url: t.String({
    description: 'Public https url the api fetches the archive from.',
    pattern: REMOTE_URL_PATTERN,
    maxLength: MAX_REMOTE_URL_LENGTH,
  }),
  sha256: t.Optional(Sha256DigestSchema),
});

export const CreateImportBodySchema = t.Union([UploadedArchiveSchema, FetchedArchiveSchema]);
export const CreateImportResponseSchema = t.Union([StagedUploadSchema, ImportSchema]);

// Said by the only end that knows: the upload happened between the caller and the store, so the
// api learns how it went by being told.
export const UpdateImportBodySchema = t.Object({
  upload: t.Union([t.Literal('complete'), t.Literal('failed')]),
});

export const ImportResponseSchema = ImportSchema;

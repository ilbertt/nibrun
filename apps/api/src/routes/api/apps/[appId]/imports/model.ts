import { ByteSizeSchema, FilenameSchema, ImportIdSchema, ImportSchema } from '@repo/protocol';
import { t } from 'elysia';

// The bytes the owner holds. The name is theirs, not the store's: keys here are assigned one per
// row, so they carry none, and this is the only name anybody would recognise the archive by.
//
// The size is answered before anything is signed, and then signed into the url: the store holds
// the upload to exactly it.
export const CreateImportBodySchema = t.Object({
  filename: FilenameSchema,
  sizeBytes: ByteSizeSchema,
});

export const CreateImportResponseSchema = t.Object({
  importId: ImportIdSchema,
  url: t.String({ description: 'Where to PUT the archive, as the whole request body.' }),
});

// Said by the only end that knows: the upload happened between the caller and the store, so the
// api learns how it went by being told.
export const UpdateImportBodySchema = t.Object({
  upload: t.Union([t.Literal('complete'), t.Literal('failed')]),
});

export const ImportResponseSchema = ImportSchema;

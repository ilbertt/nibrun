import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError, unwrap } from '@repo/api-client/unwrap';
import type { Filename, ImportId } from '@repo/protocol';
import { refusedArchiveBody } from '#archive.ts';
import { mebibytes, putObject, type UploadTransport, type UploadWait } from '#upload.ts';

/**
 * An archive an app's filesystem can be created holding, as the end sending it has one. Its root
 * becomes the root of `data/`, so what is in it is the whole of what the app will find there.
 *
 * Shaped like an artifact's upload and named apart from one: the two travel the same way and mean
 * nothing alike, and a caller holding both must not be able to send either where the other goes.
 */
export type UploadableArchive = {
  name: Filename;
  body: Blob;
};

/**
 * Upload an archive against the app it is for, and hand back the import that names it.
 *
 * The bytes go to the object store rather than through the api, exactly as an artifact's do and
 * for a stronger reason: this is a whole dataset. The api creates the import, says where to put
 * the bytes, and is told afterwards how that went.
 *
 * It is told either way. Only this end watched the upload happen, so an import whose bytes never
 * arrived is one nothing else can ever find out about — and the row and the object it names would
 * both sit there until they were swept.
 *
 * What is being sent is read before any of that. The api refuses the same bytes for the same
 * reasons, but only once they have all arrived — so asking here is the difference between a
 * sentence and a gibibyte, and every caller gets the same one rather than remembering to ask.
 */
export async function uploadImport({
  api,
  appId,
  archive,
  whileUploading,
  upload,
}: {
  api: PublicApiClient;
  appId: string;
  archive: UploadableArchive;
  whileUploading: UploadWait;
  upload: UploadTransport;
}): Promise<ImportId> {
  const refusal = await refusedArchiveBody(archive);
  if (refusal) {
    throw new ApiError(refusal);
  }
  const { importId, url } = unwrap(
    await api.api.apps({ appId }).imports.post({
      filename: archive.name,
      sizeBytes: archive.body.size,
    }),
  );
  const pending = api.api.apps({ appId }).imports({ importId });

  try {
    await whileUploading({
      message: `uploading ${archive.name} (${mebibytes(archive.body.size)})`,
      task: (report) => putObject({ url, body: archive.body, upload, onProgress: report }),
    });
  } catch (failure) {
    await pending.patch({ upload: 'failed' });
    throw failure;
  }

  unwrap(await pending.patch({ upload: 'complete' }));
  return importId;
}

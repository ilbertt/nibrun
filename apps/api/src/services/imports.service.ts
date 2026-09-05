import {
  type AppId,
  type Filename,
  type Import,
  type ImportId,
  type ObjectKey,
  ObjectKeySchema,
  type OwnerId,
  type Sha256Digest,
  Sha256DigestSchema,
  Value,
} from '@repo/protocol';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type { ImportRow, ImportsRepositoryContract } from '#repositories/imports.repository.ts';
import { Service } from '#services/service.ts';

const NO_SUCH_APP = 'App not found.';
const NO_SUCH_IMPORT = 'Import not found.';
const NO_SUCH_UPLOAD = 'No upload is awaiting that import.';
const NOTHING_UPLOADED = 'Nothing was uploaded against that import.';

const BYTES_PER_GIBIBYTE = 1_073_741_824;
const MAX_IMPORT_GIBIBYTES = 1;

/**
 * What an owner may send as an app's starting data.
 *
 * Refused before anything is signed, and then signed into the url: the store holds the upload to
 * exactly the size that was declared, so a larger body is not the request that was agreed to.
 * Checked once more while hashing, because the store is not this api and a bucket that let
 * something through is not an argument for keeping it.
 *
 * What the archive *expands* to is a different bound and not this one — the host holds it to a
 * ceiling of its own while it unpacks, because a quarter of a gibibyte of zeros is a 255 KB
 * upload.
 */
export const MAX_IMPORT_SIZE_BYTES = MAX_IMPORT_GIBIBYTES * BYTES_PER_GIBIBYTE;
const TOO_LARGE = `An import may be at most ${MAX_IMPORT_GIBIBYTES} GiB.`;

/** Long enough that the signed url the row was handed has expired, so no bytes are still coming. */
const ABANDONED_AFTER_SECONDS = 86_400;

/**
 * How many spent archives one host report clears. A gibibyte apiece and one delete each, on a path
 * a host is waiting at the end of — so this drains rather than sweeps, exactly as the app purge
 * does, and what it does not reach the next report finds still listed.
 */
const SPENT_BATCH = 8;

const DIGEST_ALGORITHM = 'sha256';
const HEX_ENCODING = 'hex';

export type ImportUpload = {
  importId: ImportId;
  url: string;
};

/** What the bytes decided, which is everything about them the row does not have until now. */
type UploadedArchive = { digest: Sha256Digest; sizeBytes: number };

export class ImportsService extends Service {
  private readonly importsRepo: ImportsRepositoryContract;
  private readonly storageRepo: ArtifactStorageRepositoryContract;
  private readonly appsRepo: AppsRepositoryContract;

  constructor({
    importsRepo,
    storageRepo,
    appsRepo,
  }: {
    importsRepo: ImportsRepositoryContract;
    storageRepo: ArtifactStorageRepositoryContract;
    appsRepo: AppsRepositoryContract;
  }) {
    super();
    this.importsRepo = importsRepo;
    this.storageRepo = storageRepo;
    this.appsRepo = appsRepo;
  }

  /**
   * Begin an import: a row with nothing the bytes decide, and somewhere to put them.
   *
   * The row comes first because it is what the upload is addressed by, exactly as an artifact's
   * is. What differs is where the bytes land: an artifact is copied to the key its digest names
   * once it has been hashed, and this is not content-addressed at all — one key per row, so the
   * key is known before the upload and the object is written straight to it. Nothing reads it
   * until the row carries a digest, and no second copy of an owner's dataset is ever made.
   */
  async create({
    appId,
    ownerId,
    filename,
    sizeBytes,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    filename: Filename;
    sizeBytes: number;
  }): Promise<ImportUpload> {
    if (!(await this.appsRepo.isOwnedBy({ appId, ownerId }))) {
      throw new NotFoundError(NO_SUCH_APP);
    }
    if (sizeBytes > MAX_IMPORT_SIZE_BYTES) {
      throw new BadRequestError(TOO_LARGE);
    }

    const pending = await this.importsRepo.insertPending({
      appId,
      ownerId,
      originalFileName: filename,
    });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    const url = await this.storageRepo.signUpload({
      objectKey: importKey({ appId, importId: pending.id }),
      sizeBytes,
    });

    return { importId: pending.id, url };
  }

  /**
   * Take the caller's word that the bytes are there, and nothing else about them.
   *
   * They are read back and hashed rather than trusted, because the digest is what a host verifies
   * before it will create a filesystem from one: a wrong digest accepted here becomes a volume
   * that never provisions, which is the failure this end exists to turn into a rejected request.
   *
   * What is *inside* the archive is not asked about. An artifact is refused unless it is a Linux
   * executable because a host has to run it; here the archive is the payload, and what it holds is
   * the owner's business until the host unpacks it.
   */
  async completeUpload({
    appId,
    ownerId,
    importId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    importId: ImportId;
  }): Promise<Import> {
    const pending = await this.importsRepo.findPending({ appId, importId, ownerId });
    if (!pending) {
      return await this.alreadyStored({ appId, importId, ownerId });
    }

    const objectKey = importKey({ appId, importId });
    if (!(await this.storageRepo.exists({ objectKey }))) {
      throw new BadRequestError(NOTHING_UPLOADED);
    }

    const uploaded = await this.read({ objectKey });
    if (!uploaded) {
      await this.discard({ objectKey });
      throw new BadRequestError(TOO_LARGE);
    }

    const stored = await this.importsRepo.complete({
      appId,
      importId,
      ownerId,
      objectKey,
      ...uploaded,
    });
    if (!stored) {
      return await this.alreadyStored({ appId, importId, ownerId });
    }
    this.logger.info('import stored', { appId, importId, sizeBytes: uploaded.sizeBytes });
    return toImport(stored);
  }

  /**
   * The caller says the upload will not be coming. Taken at face value: they are the only one who
   * knows, and the row is theirs — so it goes now rather than waiting a day to be swept.
   */
  async failUpload({
    appId,
    ownerId,
    importId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    importId: ImportId;
  }): Promise<void> {
    const pending = await this.importsRepo.findPending({ appId, importId, ownerId });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }
    await this.discard({ objectKey: importKey({ appId, importId }) });
    await this.importsRepo.remove({ appId, importId, ownerId });
  }

  async get({
    appId,
    importId,
    ownerId,
  }: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<Import> {
    const row = await this.importsRepo.findById({ appId, importId, ownerId });
    if (!row) {
      throw new NotFoundError(NO_SUCH_IMPORT);
    }
    return toImport(row);
  }

  /**
   * Uploads nobody ever came back about, driven off the rows still waiting rather than off the
   * moment one was signed — so a pass that fails part way is retried by the next one finding the
   * same rows. Objects before rows, as everywhere else: a row removed first leaves an owner's
   * dataset sitting in a bucket with nothing naming it.
   */
  async sweepAbandoned(): Promise<void> {
    const abandoned = await this.importsRepo.listAbandoned({
      olderThanSeconds: ABANDONED_AFTER_SECONDS,
    });
    for (const row of abandoned) {
      await this.discard({ objectKey: importKey({ appId: row.app_id, importId: row.id }) });
      await this.importsRepo.removeAbandoned({ importId: row.id });
      this.logger.info('abandoned import swept', { appId: row.app_id, importId: row.id });
    }
  }

  /**
   * Archives that can no longer create a filesystem, because the app's already exists.
   *
   * The bucket's own expiry is the backstop for an upload nobody ever deployed; this is for the
   * ones that have already done their job, and eventually is far too long to leave an owner's whole
   * dataset lying in a bucket beside the filesystem it became. The row stays and keeps the digest;
   * only the bytes go.
   *
   * Objects before rows, as everywhere else: a row that stopped naming its object first would leave
   * an owner's dataset behind with nothing left to find it by.
   */
  async sweepSpent(): Promise<void> {
    for (const row of await this.importsRepo.listSpent({ limit: SPENT_BATCH })) {
      try {
        await this.storageRepo.remove({ objectKey: row.object_key });
        await this.importsRepo.forgetObject({ importId: row.id });
        this.logger.info('spent import removed', { importId: row.id });
      } catch (error) {
        // The row goes on naming the object, so the next report finds it again. One bucket refusal
        // is no reason to fail the report or to skip the archives queued behind it.
        this.logger.error('a spent import could not be removed', { importId: row.id, error });
      }
    }
  }

  /**
   * What the object came to, or nothing where it came to more than may be stored. Streamed and
   * hashed a chunk at a time: this is as large as a whole dataset, and holding one in memory is
   * the cost signing the upload away was meant to avoid.
   */
  private async read({ objectKey }: { objectKey: ObjectKey }): Promise<UploadedArchive | null> {
    const hasher = new Bun.CryptoHasher(DIGEST_ALGORITHM);
    let sizeBytes = 0;
    for await (const chunk of this.storageRepo.read({ objectKey })) {
      sizeBytes += chunk.byteLength;
      // Leaving the loop cancels the read, so an object already past the cap costs one chunk
      // rather than the whole of itself.
      if (sizeBytes > MAX_IMPORT_SIZE_BYTES) {
        return null;
      }
      hasher.update(chunk);
    }
    return { digest: Value.Parse(Sha256DigestSchema, hasher.digest(HEX_ENCODING)), sizeBytes };
  }

  /** A second report of the same upload, which is the row it already made rather than an error. */
  private async alreadyStored({
    appId,
    importId,
    ownerId,
  }: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<Import> {
    const stored = await this.importsRepo.findById({ appId, importId, ownerId });
    if (!stored) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }
    return toImport(stored);
  }

  /**
   * The object is spent either way, and the bucket's own expiry is what guarantees it goes.
   * Failing the request over it would report an upload that did not happen, so this is logged and
   * left to the rule.
   */
  private async discard({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    try {
      await this.storageRepo.remove({ objectKey });
    } catch (error) {
      this.logger.warn('an uploaded import could not be removed', { objectKey, error });
    }
  }
}

/**
 * One key per row, deliberately not the digest. Two owners uploading identical bytes must not
 * share an object: expiring one would take the other's away, and neither of them agreed to that.
 */
export function importKey({ appId, importId }: { appId: AppId; importId: ImportId }): ObjectKey {
  return Value.Parse(ObjectKeySchema, `imports/${appId}/${importId}`);
}

function toImport(row: ImportRow): Import {
  return {
    id: row.id,
    appId: row.app_id,
    digest: row.digest,
    sizeBytes: Number(row.size_bytes),
    originalFileName: row.original_file_name,
    createdAt: toTimestamp(row.created_at),
  };
}

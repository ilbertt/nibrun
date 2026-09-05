import type { AppId, Filename, ImportId, ObjectKey, OwnerId, Sha256Digest } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { Repository } from '#repositories/repository.ts';

export type ImportRow = Queries['SelectImportById'];
export type PendingImportRow = Queries['SelectPendingImport'];
export type AbandonedImportRow = Queries['SelectAbandonedImports'];

export type CompleteImportInput = {
  appId: AppId;
  importId: ImportId;
  ownerId: OwnerId;
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
};

export abstract class ImportsRepositoryContract {
  abstract insertPending(input: {
    appId: AppId;
    ownerId: OwnerId;
    originalFileName: Filename;
  }): Promise<PendingImportRow | null>;
  abstract complete(input: CompleteImportInput): Promise<ImportRow | null>;
  abstract remove(input: { appId: AppId; importId: ImportId; ownerId: OwnerId }): Promise<void>;
  abstract findPending(input: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<PendingImportRow | null>;
  abstract findById(input: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<ImportRow | null>;
  abstract listAbandoned(input: { olderThanSeconds: number }): Promise<AbandonedImportRow[]>;
  abstract removeAbandoned(input: { importId: ImportId }): Promise<void>;
}

/**
 * `digest IS NOT NULL` is what separates an archive from an upload still in flight, so every read
 * that returns one carries it. A row without it names bytes that may never arrive.
 */
export class ImportsRepository extends Repository implements ImportsRepositoryContract {
  async insertPending({
    appId,
    ownerId,
    originalFileName,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    originalFileName: Filename;
  }): Promise<PendingImportRow | null> {
    const [row] = await this.sql.InsertPendingImport`
      INSERT INTO nibrun.imports (app_id, original_file_name)
      SELECT a.id, ${originalFileName}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING id, app_id, original_file_name, created_at
    `;
    return row ?? null;
  }

  /**
   * Only ever the first time: the guard is what stops a second report of the same upload from
   * rewriting an archive a deployment already points at.
   */
  async complete({
    appId,
    importId,
    ownerId,
    digest,
    sizeBytes,
    objectKey,
  }: CompleteImportInput): Promise<ImportRow | null> {
    const [row] = await this.sql.CompleteImport`
      /* @notNull digest */
      /* @notNull size_bytes */
      UPDATE nibrun.imports im
      SET digest = ${digest}, size_bytes = ${sizeBytes}, object_key = ${objectKey}
      FROM nibrun.live_apps a
      WHERE im.id = ${importId} AND im.app_id = ${appId} AND a.id = im.app_id
        AND a.owner_id = ${ownerId} AND im.digest IS NULL
      RETURNING im.id, im.app_id, im.digest, im.size_bytes, im.original_file_name, im.created_at
    `;
    return row ?? null;
  }

  async remove({
    appId,
    importId,
    ownerId,
  }: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<void> {
    await this.sql.DeleteImport`
      DELETE FROM nibrun.imports im
      USING nibrun.live_apps a
      WHERE im.id = ${importId} AND im.app_id = ${appId} AND a.id = im.app_id
        AND a.owner_id = ${ownerId} AND im.digest IS NULL
    `;
  }

  async findPending({
    appId,
    importId,
    ownerId,
  }: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<PendingImportRow | null> {
    const [row] = await this.sql.SelectPendingImport`
      SELECT im.id, im.app_id, im.original_file_name, im.created_at
      FROM nibrun.imports im
      JOIN nibrun.live_apps a ON a.id = im.app_id
      WHERE im.id = ${importId} AND im.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND im.digest IS NULL
    `;
    return row ?? null;
  }

  async findById({
    appId,
    importId,
    ownerId,
  }: {
    appId: AppId;
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<ImportRow | null> {
    const [row] = await this.sql.SelectImportById`
      /* @notNull digest */
      /* @notNull size_bytes */
      SELECT im.id, im.app_id, im.digest, im.size_bytes, im.original_file_name, im.created_at
      FROM nibrun.imports im
      JOIN nibrun.live_apps a ON a.id = im.app_id
      WHERE im.id = ${importId} AND im.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND im.digest IS NOT NULL
    `;
    return row ?? null;
  }

  /**
   * An upload nobody ever reported on. Old enough that the signed URL it was handed has long
   * expired, so nothing is still on its way to the key this row is addressed by.
   */
  listAbandoned({ olderThanSeconds }: { olderThanSeconds: number }): Promise<AbandonedImportRow[]> {
    return this.sql.SelectAbandonedImports`
      SELECT im.id, im.app_id
      FROM nibrun.imports im
      WHERE im.digest IS NULL
        AND im.created_at < now() - make_interval(secs => ${olderThanSeconds})
    `;
  }

  /**
   * No owner, because no owner asked: this is the sweep, and the row it names came from a listing
   * of what is still pending rather than from anybody's request. `digest IS NULL` is carried
   * anyway, so a row completed since that listing is left alone.
   */
  async removeAbandoned({ importId }: { importId: ImportId }): Promise<void> {
    await this.sql.DeleteAbandonedImport`
      DELETE FROM nibrun.imports im
      WHERE im.id = ${importId} AND im.digest IS NULL
    `;
  }
}

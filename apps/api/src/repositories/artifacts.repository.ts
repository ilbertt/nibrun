import type { AppId, ArtifactId, Filename, ObjectKey, OwnerId, Sha256Digest } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { Repository } from '#repositories/repository.ts';

export type ArtifactRow = Queries['SelectArtifactById'];
export type PendingArtifactRow = Queries['SelectPendingArtifact'];
export type AbandonedArtifactRow = Queries['SelectAbandonedArtifacts'];

export type InsertPendingArtifactInput = {
  appId: AppId;
  ownerId: OwnerId;
  originalFileName: Filename;
  // Only an artifact the api fetched has one, so the column it lands in is nullable and this is
  // how a caller says the bytes were sent instead.
  originalFileUrl: string | null;
  // What the download was held to, where anybody said. Null is every upload, every url nobody
  // vouched for, and every url whose bytes are not this api's to hand on.
  sourceDigest: Sha256Digest | null;
  // Whether the app takes this one artifact and no other, pending or not.
  onlyOne: boolean;
};

/** `held` is an app asked to take only one artifact that already has one. */
export type PendingArtifactInsert =
  | { outcome: 'created'; row: PendingArtifactRow }
  | { outcome: 'no-app' }
  | { outcome: 'held' };

export type CompleteArtifactInput = {
  appId: AppId;
  artifactId: ArtifactId;
  ownerId: OwnerId;
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
};

export abstract class ArtifactsRepositoryContract {
  abstract insertPending(input: InsertPendingArtifactInput): Promise<PendingArtifactInsert>;
  abstract complete(input: CompleteArtifactInput): Promise<ArtifactRow | null>;
  abstract remove(input: { appId: AppId; artifactId: ArtifactId; ownerId: OwnerId }): Promise<void>;
  abstract findPending(input: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<PendingArtifactRow | null>;
  abstract listAbandoned(input: { olderThanSeconds: number }): Promise<AbandonedArtifactRow[]>;
  abstract removeAbandoned(input: { artifactId: ArtifactId }): Promise<void>;
  abstract listByApp(input: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]>;
  abstract findById(input: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<ArtifactRow | null>;
}

/**
 * `digest IS NOT NULL` is what separates an artifact from an upload still in flight, so every
 * read that returns one carries it. A row without it names bytes that may never arrive.
 */
export class ArtifactsRepository extends Repository implements ArtifactsRepositoryContract {
  /**
   * An app that takes only one is counted and written in one transaction with its row locked,
   * for the reason the app quota is: requests arriving together would otherwise each count none
   * and each take the one place. The count is its own statement rather than a predicate on the
   * insert, because a statement's snapshot is taken before it blocks — a predicate would count
   * the artifacts as they were before the transaction it waited for committed.
   *
   * Pending rows count. An upload still in flight is the place already taken, or a stranger
   * would start as many as they like and complete one.
   */
  insertPending({
    appId,
    ownerId,
    originalFileName,
    originalFileUrl,
    sourceDigest,
    onlyOne,
  }: InsertPendingArtifactInput): Promise<PendingArtifactInsert> {
    return this.sql.begin(async (tx): Promise<PendingArtifactInsert> => {
      if (onlyOne) {
        const [locked] = await tx.SelectAppForOnlyArtifact`
          SELECT a.id FROM nibrun.live_apps a
          WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
          FOR UPDATE
        `;
        if (!locked) {
          return { outcome: 'no-app' };
        }
        const [held] = await tx.SelectArtifactHeldByApp`
          SELECT ar.id FROM nibrun.artifacts ar WHERE ar.app_id = ${appId} LIMIT 1
        `;
        if (held) {
          return { outcome: 'held' };
        }
      }
      const [row] = await tx.InsertPendingArtifact`
        INSERT INTO nibrun.artifacts (app_id, original_file_name, original_file_url, source_digest)
        SELECT a.id, ${originalFileName}, ${originalFileUrl}, ${sourceDigest}
        FROM nibrun.live_apps a
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
        RETURNING id, app_id, original_file_name, original_file_url, created_at
      `;
      return row ? { outcome: 'created', row } : { outcome: 'no-app' };
    });
  }

  /**
   * Only ever the first time: the guard is what stops a second report of the same upload from
   * rewriting an artifact a deployment already points at.
   */
  async complete({
    appId,
    artifactId,
    ownerId,
    digest,
    sizeBytes,
    objectKey,
  }: CompleteArtifactInput): Promise<ArtifactRow | null> {
    const [row] = await this.sql.CompleteArtifact`
      /* @notNull digest */
      /* @notNull size_bytes */
      /* @notNull object_key */
      UPDATE nibrun.artifacts ar
      SET digest = ${digest}, size_bytes = ${sizeBytes}, object_key = ${objectKey}
      FROM nibrun.live_apps a
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.id = ar.app_id
        AND a.owner_id = ${ownerId} AND ar.digest IS NULL
      RETURNING ar.id, ar.app_id, ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
                ar.original_file_url, ar.created_at
    `;
    return row ?? null;
  }

  async remove({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<void> {
    await this.sql.DeleteArtifact`
      DELETE FROM nibrun.artifacts ar
      USING nibrun.live_apps a
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.id = ar.app_id
        AND a.owner_id = ${ownerId} AND ar.digest IS NULL
    `;
  }

  async findPending({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<PendingArtifactRow | null> {
    const [row] = await this.sql.SelectPendingArtifact`
      SELECT ar.id, ar.app_id, ar.original_file_name, ar.original_file_url, ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.live_apps a ON a.id = ar.app_id
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND ar.digest IS NULL
    `;
    return row ?? null;
  }

  /**
   * An upload nobody ever reported on. Old enough that the signed URL it was handed has long
   * expired, so nothing is still on its way to the key this row is addressed by.
   */
  listAbandoned({
    olderThanSeconds,
  }: {
    olderThanSeconds: number;
  }): Promise<AbandonedArtifactRow[]> {
    return this.sql.SelectAbandonedArtifacts`
      SELECT ar.id, ar.app_id
      FROM nibrun.artifacts ar
      WHERE ar.digest IS NULL
        AND ar.created_at < now() - make_interval(secs => ${olderThanSeconds})
    `;
  }

  /**
   * No owner, because no owner asked: this is the sweep, and the row it names came from a listing
   * of what is still pending rather than from anybody's request. `digest IS NULL` is carried
   * anyway, so a row completed since that listing is left alone.
   */
  async removeAbandoned({ artifactId }: { artifactId: ArtifactId }): Promise<void> {
    await this.sql.DeleteAbandonedArtifact`
      DELETE FROM nibrun.artifacts ar
      WHERE ar.id = ${artifactId} AND ar.digest IS NULL
    `;
  }

  listByApp({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]> {
    return this.sql.SelectArtifactsByApp`
      /* @notNull digest */
      /* @notNull size_bytes */
      /* @notNull object_key */
      SELECT ar.id, ar.app_id, ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
             ar.original_file_url, ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.live_apps a ON a.id = ar.app_id
      WHERE ar.app_id = ${appId} AND a.owner_id = ${ownerId} AND ar.digest IS NOT NULL
      ORDER BY ar.id DESC
    `;
  }

  async findById({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<ArtifactRow | null> {
    const [row] = await this.sql.SelectArtifactById`
      /* @notNull digest */
      /* @notNull size_bytes */
      /* @notNull object_key */
      SELECT ar.id, ar.app_id, ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
             ar.original_file_url, ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.live_apps a ON a.id = ar.app_id
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND ar.digest IS NOT NULL
    `;
    return row ?? null;
  }
}

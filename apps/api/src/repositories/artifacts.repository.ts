import type { AppId, ArtifactId, Filename, ObjectKey, OwnerId, Sha256Digest } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type ArtifactRow = Queries['SelectArtifactById'];

export type InsertArtifactInput = {
  appId: AppId;
  ownerId: OwnerId;
  digest: Sha256Digest;
  sizeBytes: number;
  objectKey: ObjectKey;
  originalFileName: Filename;
};

export abstract class ArtifactsRepositoryContract {
  abstract insert(input: InsertArtifactInput): Promise<ArtifactRow | null>;
  abstract listByApp(input: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]>;
  abstract findById(input: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<ArtifactRow | null>;
}

export class ArtifactsRepository extends Repository implements ArtifactsRepositoryContract {
  async insert({
    appId,
    ownerId,
    digest,
    sizeBytes,
    objectKey,
    originalFileName,
  }: InsertArtifactInput): Promise<ArtifactRow | null> {
    const [row] = await this.sql.InsertArtifact`
      /* @notNull created_at */
      INSERT INTO nibrun.artifacts (app_id, digest, size_bytes, object_key, original_file_name)
      SELECT a.id, ${digest}, ${sizeBytes}, ${objectKey}, ${originalFileName}
      FROM nibrun.apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING id, app_id, digest, size_bytes, object_key, original_file_name, created_at
    `;
    return row ?? null;
  }

  listByApp({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]> {
    return this.sql.SelectArtifactsByApp`
      /* @notNull created_at */
      SELECT ar.id, ar.app_id, ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
             ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.apps a ON a.id = ar.app_id
      WHERE ar.app_id = ${appId} AND a.owner_id = ${ownerId}
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
      /* @notNull created_at */
      SELECT ar.id, ar.app_id, ar.digest, ar.size_bytes, ar.object_key, ar.original_file_name,
             ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.apps a ON a.id = ar.app_id
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }
}

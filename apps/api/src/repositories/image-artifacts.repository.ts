import type { AppId, OciImage } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { ArtifactId, OwnerId } from '#lib/api/identifiers.ts';
import { Repository } from '#repositories/repository.ts';

export type ImageArtifactRow = Queries['SelectImageArtifact'];
type OwnedApp = { appId: AppId; ownerId: OwnerId };

export abstract class ImageArtifactsRepositoryContract {
  abstract insert(input: OwnedApp & { image: OciImage }): Promise<ImageArtifactRow | null>;
  abstract findById(input: OwnedApp & { artifactId: ArtifactId }): Promise<ImageArtifactRow | null>;
  abstract listByApp(input: OwnedApp): Promise<ImageArtifactRow[]>;
}

export class ImageArtifactsRepository
  extends Repository
  implements ImageArtifactsRepositoryContract
{
  async insert({
    appId,
    ownerId,
    image,
  }: OwnedApp & { image: OciImage }): Promise<ImageArtifactRow | null> {
    const [row] = await this.sql.InsertImageArtifact`
      /* @notNull digest */
      /* @notNull image_repository */
      /* @notNull image_program */
      /* @notNull image_working_directory */
      INSERT INTO nibrun.artifacts (app_id, digest, image_repository, image_program, image_working_directory)
      SELECT a.id, ${image.digest}, ${image.repository}, ${image.program}, ${image.workingDirectory}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING id, app_id, digest, image_repository, image_program, image_working_directory, created_at
    `;
    return row ?? null;
  }

  async findById({
    appId,
    ownerId,
    artifactId,
  }: OwnedApp & { artifactId: ArtifactId }): Promise<ImageArtifactRow | null> {
    const [row] = await this.sql.SelectImageArtifact`
      /* @notNull digest */
      /* @notNull image_repository */
      /* @notNull image_program */
      /* @notNull image_working_directory */
      SELECT ar.id, ar.app_id, ar.digest, ar.image_repository, ar.image_program, ar.image_working_directory, ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.live_apps a ON a.id = ar.app_id
      WHERE ar.id = ${artifactId} AND ar.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND ar.image_repository IS NOT NULL
    `;
    return row ?? null;
  }

  listByApp({ appId, ownerId }: OwnedApp): Promise<ImageArtifactRow[]> {
    return this.sql.SelectImageArtifactsByApp`
      /* @notNull digest */
      /* @notNull image_repository */
      /* @notNull image_program */
      /* @notNull image_working_directory */
      SELECT ar.id, ar.app_id, ar.digest, ar.image_repository, ar.image_program, ar.image_working_directory, ar.created_at
      FROM nibrun.artifacts ar
      JOIN nibrun.live_apps a ON a.id = ar.app_id
      WHERE ar.app_id = ${appId} AND a.owner_id = ${ownerId} AND ar.image_repository IS NOT NULL
      ORDER BY ar.id DESC
    `;
  }
}

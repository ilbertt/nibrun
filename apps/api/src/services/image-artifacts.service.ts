import type { AppId, OciImage } from '@repo/protocol';
import type { ImageArtifact } from '#lib/api/artifact.ts';
import type { ArtifactId, OwnerId } from '#lib/api/identifiers.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type {
  ImageArtifactRow,
  ImageArtifactsRepositoryContract,
} from '#repositories/image-artifacts.repository.ts';
import type { ArtifactUploadGrant } from '#services/artifacts.service.ts';
import { Service } from '#services/service.ts';

const PUBLIC_REGISTRIES = new Set(['docker.io', 'ghcr.io', 'quay.io', 'public.ecr.aws']);
type OwnedApp = { appId: AppId; ownerId: OwnerId };

function toImageArtifact(row: ImageArtifactRow): ImageArtifact {
  return {
    id: row.id,
    appId: row.app_id,
    createdAt: toTimestamp(row.created_at),
    kind: 'oci',
    digest: row.digest,
    repository: row.image_repository,
    program: row.image_program,
    workingDirectory: row.image_working_directory,
  };
}

export class ImageArtifactsService extends Service {
  private readonly imagesRepo: ImageArtifactsRepositoryContract;

  constructor({ imagesRepo }: { imagesRepo: ImageArtifactsRepositoryContract }) {
    super();
    this.imagesRepo = imagesRepo;
  }

  async create({
    image,
    isAnonymous,
    deploymentGrant,
    ...owned
  }: OwnedApp & {
    image: OciImage;
    isAnonymous: boolean;
    deploymentGrant: ArtifactUploadGrant | null;
  }): Promise<ImageArtifact> {
    if (isAnonymous || deploymentGrant !== null) {
      throw new ForbiddenError('Sign in to deploy an OCI image.');
    }
    if (!PUBLIC_REGISTRIES.has(image.repository.split('/')[0] ?? '')) {
      throw new BadRequestError(
        `Supported public image registries: ${[...PUBLIC_REGISTRIES].join(', ')}.`,
      );
    }
    const row = await this.imagesRepo.insert({ ...owned, image });
    if (row === null) {
      throw new NotFoundError('App not found.');
    }
    return toImageArtifact(row);
  }

  async find(input: OwnedApp & { artifactId: ArtifactId }): Promise<ImageArtifact | null> {
    const row = await this.imagesRepo.findById(input);
    return row === null ? null : toImageArtifact(row);
  }

  async list(input: OwnedApp): Promise<ImageArtifact[]> {
    return (await this.imagesRepo.listByApp(input)).map(toImageArtifact);
  }
}

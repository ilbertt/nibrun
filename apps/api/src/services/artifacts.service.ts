import {
  type AppId,
  type Artifact,
  type ArtifactId,
  type Filename,
  FilenameSchema,
  isValidMessage,
  type OwnerId,
} from '@repo/protocol';
import { identifyArtifact } from '#lib/artifact-digest.ts';
import { isElfExecutable } from '#lib/elf.ts';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  ArtifactRow,
  ArtifactsRepositoryContract,
} from '#repositories/artifacts.repository.ts';
import { Service } from '#services/service.ts';

// An app the caller does not own has to be indistinguishable from one that does not exist: a
// 403 confirms the app to a stranger.
const NO_SUCH_APP = 'App not found.';
const NO_SUCH_ARTIFACT = 'Artifact not found.';
const NOT_AN_EXECUTABLE = 'The artifact is not a Linux executable.';
const NOT_A_FILENAME = 'The uploaded file must be named as a single path segment.';

export type AppOwnership = Pick<AppsRepositoryContract, 'isOwnedBy'>;

// A host writes this name into an export archive, so a browser-supplied one that is not a
// single path segment has to be refused here rather than sanitised into something else.
function asFilename(name: string): Filename {
  if (!isValidMessage({ schema: FilenameSchema, value: name })) {
    throw new BadRequestError(NOT_A_FILENAME);
  }
  return name as Filename;
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    appId: row.app_id,
    digest: row.digest,
    sizeBytes: Number(row.size_bytes),
    objectKey: row.object_key,
    originalFileName: row.original_file_name,
    createdAt: toTimestamp(row.created_at),
  };
}

export class ArtifactsService extends Service {
  private readonly artifactsRepo: ArtifactsRepositoryContract;
  private readonly storageRepo: ArtifactStorageRepositoryContract;
  private readonly appsRepo: AppOwnership;

  constructor({
    artifactsRepo,
    storageRepo,
    appsRepo,
  }: {
    artifactsRepo: ArtifactsRepositoryContract;
    storageRepo: ArtifactStorageRepositoryContract;
    appsRepo: AppOwnership;
  }) {
    super();
    this.artifactsRepo = artifactsRepo;
    this.storageRepo = storageRepo;
    this.appsRepo = appsRepo;
  }

  /**
   * The row is written last, so an artifact that exists is one whose bytes are readable —
   * there is no state to consult and no way to name an object that was never stored.
   *
   * Ownership is asked before the upload only so that an app the caller does not own costs a
   * rejected request instead of the bytes; the insert carries the same predicate and is what
   * actually decides.
   */
  async create({
    appId,
    ownerId,
    binary,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    binary: File;
  }): Promise<Artifact> {
    if (!(await this.appsRepo.isOwnedBy({ appId, ownerId }))) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    const originalFileName = asFilename(binary.name);

    const bytes = new Uint8Array(await binary.arrayBuffer());
    if (!isElfExecutable(bytes)) {
      throw new BadRequestError(NOT_AN_EXECUTABLE);
    }

    const identity = identifyArtifact(bytes);

    // Content-addressed, so an object already under this key is these bytes: re-uploading it
    // would spend the bandwidth to write what is already there.
    if (!(await this.storageRepo.exists({ objectKey: identity.objectKey }))) {
      await this.storageRepo.put({ objectKey: identity.objectKey, bytes });
    }

    const stored = await this.artifactsRepo.insert({
      appId,
      ownerId,
      originalFileName,
      ...identity,
    });
    if (!stored) {
      throw new NotFoundError(NO_SUCH_APP);
    }
    return toArtifact(stored);
  }

  async list({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<Artifact[]> {
    const rows = await this.artifactsRepo.listByApp({ appId, ownerId });
    return rows.map(toArtifact);
  }

  async get({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<Artifact> {
    const row = await this.artifactsRepo.findById({ appId, artifactId, ownerId });
    if (!row) {
      throw new NotFoundError(NO_SUCH_ARTIFACT);
    }
    return toArtifact(row);
  }
}

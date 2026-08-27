import {
  type AppId,
  type Artifact,
  type ArtifactId,
  type Filename,
  type ObjectKey,
  ObjectKeySchema,
  type OwnerId,
  Value,
} from '@repo/protocol';
import { type ArtifactInspection, inspectArtifact } from '#lib/artifact-digest.ts';
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
const NO_SUCH_UPLOAD = 'No upload is awaiting that artifact.';
const NOTHING_UPLOADED = 'Nothing was uploaded against that artifact.';
const NOT_AN_EXECUTABLE = 'The artifact is not a Linux executable.';

const BYTES_PER_MEBIBYTE = 1_048_576;
const MAX_ARTIFACT_MEBIBYTES = 256;

/**
 * What a host has to pull before a tenant can start, and what this api has to read back to hash.
 *
 * Refused here before a byte moves, which is also what bounds the signature: an upload is signed
 * for exactly the size it declared, so a binary larger than this cannot be declared and a body
 * larger than the declaration is not the request that was signed. Checked once more while hashing,
 * because the store is not this api and a bucket that let something through is not an argument for
 * storing it.
 */
export const MAX_ARTIFACT_SIZE_BYTES = MAX_ARTIFACT_MEBIBYTES * BYTES_PER_MEBIBYTE;
const TOO_LARGE = `A binary may be at most ${MAX_ARTIFACT_MEBIBYTES} MB.`;

function unsupportedInterpreter(interpreter: string): string {
  return `The artifact needs the dynamic loader at ${interpreter}, which the guest does not have. Link it against /lib64/ld-linux-x86-64.so.2, or compile it static.`;
}

/** Why the bytes were refused, in the uploader's terms rather than the inspection's. */
function refusalMessage(inspection: Exclude<ArtifactInspection, { outcome: 'stored' }>): string {
  switch (inspection.outcome) {
    case 'too-large':
      return TOO_LARGE;
    case 'unsupported-interpreter':
      return unsupportedInterpreter(inspection.interpreter);
    case 'not-executable':
      return NOT_AN_EXECUTABLE;
  }
}

/**
 * Long enough that no upload is still on its way to a row this old — the signed policy expires
 * far sooner — and no longer than the bucket rule that expires the staged object, so a row and
 * the bytes it was waiting for are not left outliving each other.
 */
const ABANDONED_AFTER_SECONDS = 86_400;

// One slot per upload, under the app it belongs to. The app is in the key so that a signed policy
// can only ever be spent inside the app whose ownership was checked to obtain it, and the
// artifact's own id is in it so that two uploads never write over each other.
const UPLOAD_PREFIX = 'uploads';

export type AppOwnership = Pick<AppsRepositoryContract, 'isOwnedBy'>;

export type ArtifactUpload = {
  artifactId: ArtifactId;
  url: string;
};

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
   * Begin an artifact: a row with nothing the bytes decide, and somewhere to put them.
   *
   * The row comes first because it is what the upload is addressed by — there is no second
   * identifier for a binary on its way in, and inventing one would be a name for the same thing.
   * What the bytes decide stays absent until they are read, so nothing here is the uploader's
   * word about its own upload.
   *
   * The declared size is refused before anything is signed, so a binary over the limit costs a
   * request rather than the upload; the policy is what holds the upload to it afterwards.
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
  }): Promise<ArtifactUpload> {
    if (!(await this.appsRepo.isOwnedBy({ appId, ownerId }))) {
      throw new NotFoundError(NO_SUCH_APP);
    }
    if (sizeBytes > MAX_ARTIFACT_SIZE_BYTES) {
      throw new BadRequestError(TOO_LARGE);
    }

    const pending = await this.artifactsRepo.insertPending({
      appId,
      ownerId,
      originalFileName: filename,
    });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    const url = await this.storageRepo.signUpload({
      objectKey: stagingKey({ appId, artifactId: pending.id }),
      sizeBytes,
    });

    return { artifactId: pending.id, url };
  }

  /**
   * Take the caller's word that the bytes are there, and nothing else about them.
   *
   * They are read back and hashed rather than trusted, because the digest is what a host verifies
   * before it will run one: a wrong digest accepted here becomes a deployment that never
   * converges, which is the failure this end exists to turn into a rejected request.
   *
   * That read is also what keeps the content-addressed namespace honest. Only this process writes
   * it, and only from bytes it has just hashed — so a key already there is bytes that were
   * verified on their way in, and copying them again would spend the bandwidth to write what is
   * already stored.
   *
   * The digest is written last, and writing it is what makes the row an artifact.
   */
  async completeUpload({
    appId,
    ownerId,
    artifactId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    artifactId: ArtifactId;
  }): Promise<Artifact> {
    const pending = await this.artifactsRepo.findPending({ appId, artifactId, ownerId });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }

    const staged = stagingKey({ appId, artifactId });
    if (!(await this.storageRepo.exists({ objectKey: staged }))) {
      throw new BadRequestError(NOTHING_UPLOADED);
    }

    const inspection = await inspectArtifact({
      stream: this.storageRepo.read({ objectKey: staged }),
      maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES,
    });
    if (inspection.outcome !== 'stored') {
      await this.abandon({ appId, artifactId, ownerId });
      throw new BadRequestError(refusalMessage(inspection));
    }

    const { digest, sizeBytes, objectKey } = inspection;
    if (!(await this.storageRepo.exists({ objectKey }))) {
      await this.storageRepo.copy({ from: staged, to: objectKey });
    }

    const stored = await this.artifactsRepo.complete({
      appId,
      artifactId,
      ownerId,
      digest,
      sizeBytes,
      objectKey,
    });
    if (!stored) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }

    await this.discard({ objectKey: staged });

    return toArtifact(stored);
  }

  /**
   * The caller says the upload will not be coming. Taken at face value: they are the only one who
   * knows, and the row is theirs — so it goes now rather than waiting a day to be swept.
   */
  async failUpload({
    appId,
    ownerId,
    artifactId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    artifactId: ArtifactId;
  }): Promise<void> {
    const pending = await this.artifactsRepo.findPending({ appId, artifactId, ownerId });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }
    await this.abandon({ appId, artifactId, ownerId });
  }

  /**
   * Uploads nobody ever came back about. Driven off the rows still waiting rather than off the
   * moment one was signed, so a pass that fails part way is retried by the next one finding the
   * same rows — and rows left by anything that happened before this existed are swept too.
   *
   * Objects before rows, as everywhere else: a row removed first leaves bytes nothing names.
   */
  async sweepAbandoned(): Promise<void> {
    const abandoned = await this.artifactsRepo.listAbandoned({
      olderThanSeconds: ABANDONED_AFTER_SECONDS,
    });
    for (const row of abandoned) {
      await this.discard({ objectKey: stagingKey({ appId: row.app_id, artifactId: row.id }) });
      await this.artifactsRepo.removeAbandoned({ artifactId: row.id });
      this.logger.info('abandoned upload swept', { appId: row.app_id, artifactId: row.id });
    }
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

  private async abandon({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<void> {
    await this.discard({ objectKey: stagingKey({ appId, artifactId }) });
    await this.artifactsRepo.remove({ appId, artifactId, ownerId });
  }

  /**
   * A staging slot is spent either way, and the bucket's own expiry is what guarantees it goes.
   * Failing the request over it would report an upload that did not happen — the artifact is
   * stored and the row is written — so this is logged and left to the rule.
   */
  private async discard({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    try {
      await this.storageRepo.remove({ objectKey });
    } catch (error) {
      this.logger.warn('a staged upload could not be removed', { objectKey, error });
    }
  }
}

function stagingKey({ appId, artifactId }: { appId: AppId; artifactId: ArtifactId }): ObjectKey {
  return Value.Parse(ObjectKeySchema, `${UPLOAD_PREFIX}/${appId}/${artifactId}`);
}

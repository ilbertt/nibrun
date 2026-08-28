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
import {
  type ArtifactInspection,
  ArtifactTooLargeError,
  cappedTo,
  inspectArtifact,
} from '#lib/artifact-digest.ts';
import { filenameFromUrl } from '#lib/binary-url.ts';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  ArtifactRow,
  ArtifactsRepositoryContract,
} from '#repositories/artifacts.repository.ts';
import type {
  BinarySource,
  BinarySourceRepositoryContract,
} from '#repositories/binary-source.repository.ts';
import { Service } from '#services/service.ts';

// An app the caller does not own has to be indistinguishable from one that does not exist: a
// 403 confirms the app to a stranger.
const NO_SUCH_APP = 'App not found.';
const NO_SUCH_ARTIFACT = 'Artifact not found.';
const NO_SUCH_UPLOAD = 'No upload is awaiting that artifact.';
const NOTHING_UPLOADED = 'Nothing was uploaded against that artifact.';
const UNNAMED_BINARY =
  "The url has to end in the binary's own name, as a release download does: .../my-server";
const NOTHING_FETCHED = 'The url answered with no body.';
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

/**
 * A url that answers nothing, said with the url in it. The api reaches it from where the api runs
 * rather than from where the link was followed, so a host only the caller's own network can see is
 * a url that works everywhere they tried it and nowhere this runs.
 */
function unreachable(url: string): string {
  return `The url could not be reached from nibrun: ${url}`;
}

function refusedBy({ url, status }: { url: string; status: number }): string {
  return `The url answered ${status}, so there was nothing to deploy: ${url}`;
}

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
  private readonly sourceRepo: BinarySourceRepositoryContract;
  private readonly appsRepo: AppOwnership;

  constructor({
    artifactsRepo,
    storageRepo,
    sourceRepo,
    appsRepo,
  }: {
    artifactsRepo: ArtifactsRepositoryContract;
    storageRepo: ArtifactStorageRepositoryContract;
    sourceRepo: BinarySourceRepositoryContract;
    appsRepo: AppOwnership;
  }) {
    super();
    this.artifactsRepo = artifactsRepo;
    this.storageRepo = storageRepo;
    this.sourceRepo = sourceRepo;
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
      originalFileUrl: null,
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

    return await this.promote({ appId, artifactId, ownerId, staged, inspection });
  }

  /**
   * The bytes fetched instead of sent, which is the only way some of them can arrive at all: a
   * release asset is served by a store that answers no cross-origin request, so a browser cannot
   * read one to upload it. It is also the shorter path — the api holds the bytes once, on their
   * way past, rather than reading back what a caller already sent.
   *
   * Hashed on that same pass. The stream is teed, so what is written to the staging key and what
   * decides whether it is an artifact at all are one read of the source.
   */
  async createFromUrl({
    appId,
    ownerId,
    url,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    url: string;
  }): Promise<Artifact> {
    if (!(await this.appsRepo.isOwnedBy({ appId, ownerId }))) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    // The name a host writes into an export comes from the url, because nobody else is here to
    // give one. A url that ends in no name at all is refused before it is fetched.
    const filename = filenameFromUrl(url);
    if (filename === undefined) {
      throw new BadRequestError(UNNAMED_BINARY);
    }

    const source = await this.sourceRepo.open({ url });
    if (source.outcome !== 'open') {
      throw new BadRequestError(sourceRefusal({ url, source }));
    }
    if (
      source.declaredSizeBytes !== undefined &&
      source.declaredSizeBytes > MAX_ARTIFACT_SIZE_BYTES
    ) {
      throw new BadRequestError(TOO_LARGE);
    }

    const pending = await this.artifactsRepo.insertPending({
      appId,
      ownerId,
      originalFileName: filename,
      originalFileUrl: url,
    });
    if (!pending) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    const staged = stagingKey({ appId, artifactId: pending.id });
    const inspection = await this.stage({ staged, body: source.body });

    return await this.promote({ appId, artifactId: pending.id, ownerId, staged, inspection });
  }

  /**
   * The source read once, into the staging key and into the inspection at the same time.
   *
   * Capped before it is teed rather than by the inspection alone: a refusal only stops the branch
   * that reached it, and the branch still writing would otherwise spend a bucket on however much
   * a url that lied about its length cares to send.
   */
  private async stage({
    staged,
    body,
  }: {
    staged: ObjectKey;
    body: ReadableStream<Uint8Array>;
  }): Promise<ArtifactInspection> {
    const [stored, inspected] = body
      .pipeThrough(cappedTo({ maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES }))
      .tee();
    try {
      const [, inspection] = await Promise.all([
        this.storageRepo.write({ objectKey: staged, body: stored }),
        inspectArtifact({ stream: inspected, maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES }),
      ]);
      return inspection;
    } catch (failure) {
      // One branch failing leaves the other reading a source nothing will consume, so both are
      // let go of before the failure is anybody else's.
      await Promise.allSettled([stored.cancel(), inspected.cancel()]);
      if (failure instanceof ArtifactTooLargeError) {
        return { outcome: 'too-large' };
      }
      throw failure;
    }
  }

  /**
   * The staged bytes as the artifact they turned out to be, which is the same last step whether
   * they were uploaded or fetched: what the inspection settled is written down, the bytes are put
   * where their digest says, and the slot they came through is given up.
   */
  private async promote({
    appId,
    artifactId,
    ownerId,
    staged,
    inspection,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
    staged: ObjectKey;
    inspection: ArtifactInspection;
  }): Promise<Artifact> {
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

/** Why the url gave nothing to store, in the terms of whoever wrote the link. */
function sourceRefusal({
  url,
  source,
}: {
  url: string;
  source: Exclude<BinarySource, { outcome: 'open' }>;
}): string {
  switch (source.outcome) {
    case 'unreachable':
      return unreachable(url);
    case 'refused':
      return refusedBy({ url, status: source.status });
    case 'empty':
      return NOTHING_FETCHED;
  }
}

function stagingKey({ appId, artifactId }: { appId: AppId; artifactId: ArtifactId }): ObjectKey {
  return Value.Parse(ObjectKeySchema, `${UPLOAD_PREFIX}/${appId}/${artifactId}`);
}

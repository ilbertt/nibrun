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
  boundedTo,
  inspectArtifact,
  inspectingPassThrough,
  RefusedArtifactError,
} from '#lib/artifact-digest.ts';
import { filenameFromUrl, withoutCredentials } from '#lib/binary-url.ts';
import { BadRequestError, NotFoundError, TooManyRequestsError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  ArtifactRow,
  ArtifactsRepositoryContract,
} from '#repositories/artifacts.repository.ts';
import {
  type BinarySource,
  type BinarySourceRepositoryContract,
  InterruptedSourceError,
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
const TOO_MANY_REDIRECTS = 'The url redirected more times than nibrun will follow.';
const NOT_AN_EXECUTABLE = 'The artifact is not a Linux executable.';

/**
 * A binary being fetched passes through this process, which is the cost signing an upload away was
 * meant to avoid paying — so how many may be in flight at once is a number rather than whatever a
 * caller starts. Refused rather than queued: a caller told to come back has a request that ended,
 * while one held in a queue is one more transfer this end is carrying while it waits.
 */
export const MAX_CONCURRENT_FETCHES = 8;
const TOO_MANY_FETCHES =
  'nibrun is fetching as many binaries as it will at once. Try again in a moment.';

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

/**
 * The hop that was refused rather than the address that was typed: a redirect out of https is one
 * the caller never saw, and naming it is the difference between a link they can fix and a fetch
 * that failed for no reason they can see.
 */
function insecureRedirect(to: string): string {
  return `The url redirected to ${withoutCredentials(to)}, which is not an https address nibrun will follow.`;
}

/**
 * A url that resolves inside the network the api runs in. Refused rather than fetched: the api can
 * reach addresses the caller cannot, so following one on their behalf lends them a position they
 * were never given — and tells them, in which sentence comes back, what is listening there.
 */
function privateAddress(host: string): string {
  return `${host} resolves inside the network nibrun runs in, which is not somewhere it will fetch from.`;
}

function interruptedSource(url: string): string {
  return `The url stopped sending before the binary was whole: ${url}`;
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
  private fetchesInFlight = 0;

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
   * Hashed on that same pass: the bytes are inspected as they are handed to the store, so what is
   * written to the staging key and what decides whether it is an artifact at all are one read.
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
    if (this.fetchesInFlight >= MAX_CONCURRENT_FETCHES) {
      throw new TooManyRequestsError(TOO_MANY_FETCHES);
    }

    this.fetchesInFlight += 1;
    try {
      return await this.fetchInto({ appId, ownerId, url, filename });
    } finally {
      this.fetchesInFlight -= 1;
    }
  }

  /**
   * The url opened and made an artifact of, with the slot it is counted against already taken.
   *
   * What is written down and said back is the url without whatever a caller authenticated by: the
   * bytes are fetched with the address as it was given, and a token in it belongs to that fetch
   * rather than to a row that outlives it.
   */
  private async fetchInto({
    appId,
    ownerId,
    url,
    filename,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    url: string;
    filename: Filename;
  }): Promise<Artifact> {
    const said = withoutCredentials(url);

    const source = await this.sourceRepo.open({ url });
    if (source.outcome !== 'open') {
      throw new BadRequestError(sourceRefusal({ url: said, source }));
    }
    if (
      source.declaredSizeBytes !== undefined &&
      source.declaredSizeBytes > MAX_ARTIFACT_SIZE_BYTES
    ) {
      await release(source.body);
      throw new BadRequestError(TOO_LARGE);
    }

    // Bounded on the way in whatever the host said about it: a declared length is a courtesy, and
    // a source that declares none is otherwise read for as long as it keeps sending.
    const fetched = source.body.pipeThrough(boundedTo({ maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES }));

    const pending = await this.artifactsRepo.insertPending({
      appId,
      ownerId,
      originalFileName: filename,
      originalFileUrl: said,
    });
    if (!pending) {
      await release(fetched);
      throw new NotFoundError(NO_SUCH_APP);
    }

    const staged = stagingKey({ appId, artifactId: pending.id });
    const inspection = await this.stageOrGiveUp({
      appId,
      artifactId: pending.id,
      ownerId,
      staged,
      body: fetched,
      url: said,
    });

    return await this.promote({ appId, artifactId: pending.id, ownerId, staged, inspection });
  }

  /**
   * The staging write, with the row taken back whichever way it fails: somebody who is going to
   * follow the same link again should not have to find what the last attempt left behind.
   *
   * A source that stopped part way is the caller's link rather than this api, and is answered as
   * such — every other way this url could be unusable already is.
   */
  private async stageOrGiveUp({
    appId,
    artifactId,
    ownerId,
    staged,
    body,
    url,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
    staged: ObjectKey;
    body: ReadableStream<Uint8Array>;
    url: string;
  }): Promise<ArtifactInspection> {
    try {
      return await this.stage({ staged, body });
    } catch (failure) {
      await this.abandon({ appId, artifactId, ownerId });
      if (failure instanceof InterruptedSourceError) {
        throw new BadRequestError(interruptedSource(url));
      }
      // A source held to a length it went past, which is the caller's url rather than this api
      // in exactly the way a 404 from it would be.
      if (failure instanceof ArtifactTooLargeError) {
        throw new BadRequestError(TOO_LARGE);
      }
      throw failure;
    }
  }

  /**
   * The source written to the staging key and inspected on the way through, which is one read of
   * it and one chunk in hand at a time. The upload the store is making is what holds the rest.
   *
   * A refusal reaches this as the write failing, because that is what it did: the inspection
   * errored the stream under it rather than letting a binary nobody will deploy finish arriving.
   */
  private async stage({
    staged,
    body,
  }: {
    staged: ObjectKey;
    body: ReadableStream<Uint8Array>;
  }): Promise<ArtifactInspection> {
    const { through, inspection } = inspectingPassThrough({
      maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES,
    });

    try {
      await this.storageRepo.write({ objectKey: staged, body: body.pipeThrough(through) });
    } catch (failure) {
      if (failure instanceof RefusedArtifactError) {
        return failure.inspection;
      }
      // The source stopped or the store did, and neither is a verdict on the binary — so the
      // inspection is never awaited here: nothing ended the stream, and nothing will settle it.
      throw failure;
    }

    return await inspection;
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
    case 'insecure-redirect':
      return insecureRedirect(source.to);
    case 'too-many-redirects':
      return TOO_MANY_REDIRECTS;
    case 'private-address':
      return privateAddress(source.host);
  }
}

/** A body nobody is going to read holds its connection open until it is let go of. */
async function release(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    return;
  }
}

function stagingKey({ appId, artifactId }: { appId: AppId; artifactId: ArtifactId }): ObjectKey {
  return Value.Parse(ObjectKeySchema, `${UPLOAD_PREFIX}/${appId}/${artifactId}`);
}

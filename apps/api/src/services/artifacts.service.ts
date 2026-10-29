import {
  type AppId,
  type Filename,
  FilenameSchema,
  type ObjectKey,
  ObjectKeySchema,
  type Sha256Digest,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Artifact } from '#lib/api/artifact.ts';
import type { ArtifactId, OwnerId } from '#lib/api/identifiers.ts';
import { unwrapExecutable } from '#lib/archive/unwrap.ts';
import {
  ExpandsTooFarError,
  MAX_ENTRIES,
  MAX_EXPANSION,
  UnreadableArchiveError,
  type Unwrapping,
} from '#lib/archive/walk.ts';
import {
  type ArtifactInspection,
  ArtifactTooLargeError,
  boundedTo,
  digesting,
  inspectArtifact,
  inspectingPassThrough,
  RefusedArtifactError,
} from '#lib/artifact-digest.ts';
import { DownloadDiagnostics, downloadOrigin } from '#lib/download-diagnostics.ts';
import { describeMachine } from '#lib/elf.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '#lib/errors.ts';
import { type RemoteFetchSlots, sourceRefusal } from '#lib/remote-fetch.ts';
import { carriesCredentials, filenameFromUrl, withoutCredentials } from '#lib/remote-url.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  ArtifactRow,
  ArtifactsRepositoryContract,
  PendingArtifactInsert,
  PendingArtifactRow,
} from '#repositories/artifacts.repository.ts';
import type {
  CachedBinariesRepositoryContract,
  CachedBinaryRow,
} from '#repositories/cached-binaries.repository.ts';
import type { GitHubDeploymentGrantRow } from '#repositories/github-deployment-grants.repository.ts';
import type {
  PublishedDigest,
  ReleaseDigestRepositoryContract,
} from '#repositories/release-digest.repository.ts';
import {
  InterruptedSourceError,
  type RemoteSourceRepositoryContract,
} from '#repositories/remote-source.repository.ts';
import { Service } from '#services/service.ts';

export type ArtifactUploadGrant = Pick<GitHubDeploymentGrantRow, 'expires_at'>;

type FetchArtifactInput = {
  appId: AppId;
  ownerId: OwnerId;
  deploymentGrant: ArtifactUploadGrant | null;
  isAnonymous: boolean;
  url: string;
  filename: Filename | undefined;
  sha256?: Sha256Digest | undefined;
};

// An app the caller does not own has to be indistinguishable from one that does not exist: a
// 403 confirms the app to a stranger.
const NO_SUCH_APP = 'App not found.';
const NO_SUCH_ARTIFACT = 'Artifact not found.';
const NO_SUCH_UPLOAD = 'No upload is awaiting that artifact.';
const NOTHING_UPLOADED = 'Nothing was uploaded against that artifact.';
const UNNAMED_BINARY =
  "The url has to end in the binary's own name, as a release download does: .../my-server";
const NOT_AN_EXECUTABLE = 'The artifact is not a Linux executable.';
// A stranger's app takes one binary. Not counted, because the number is one and the refusal is
// what to do about it.
const ONE_BINARY = 'Sign in to upload another binary to this app.';

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

function interruptedSource(url: string): string {
  return `The url stopped sending before the binary was whole: ${url}`;
}

const NOTHING_EXECUTABLE = 'Nothing inside that archive is a Linux executable.';
const WALKED_TOO_FAR = `nibrun read as far into that archive as it will — ${MAX_ARTIFACT_MEBIBYTES} MB, or ${MAX_ENTRIES} entries — without reaching an executable.`;

const ENTRY_TOO_LARGE =
  'An entry in that archive is longer than its own header can say, which is more than nibrun will read past.';

/**
 * Said as what the url served rather than as what nibrun refused to do: whoever followed the link
 * is being told their download is not the shape a release is, and the way past it is the upload
 * that was always there.
 */
const EXPANDS_TOO_FAR = `That download holds more than ${MAX_EXPANSION} times the bytes it sent, which is past anything a release is published as. Upload the binary instead.`;

function unreadableArchive(url: string): string {
  return `The archive ended before the entry it was describing: ${url}`;
}

/**
 * The url is not serving what the caller said it would. Both digests are named because either
 * could be the surprising one: the link may have been written against a release that has since
 * been replaced, or the checksum beside it may simply be the wrong one.
 */
function wrongDigest({ expected, served }: { expected: string; served: string }): string {
  return `The url served ${served}, not the ${expected} that was asked for.`;
}

/**
 * The same surprise, where nobody asked for anything. Said as what the release publishes rather
 * than as what was expected, because the caller never named a digest and would otherwise be shown
 * two numbers they have never seen and no way to tell which of them is theirs.
 */
function wrongPublishedDigest({ expected, served }: { expected: string; served: string }): string {
  return `The release publishes ${expected} for that asset and the url served ${served}, so what it is serving is not what was released.`;
}

/** A digest the download should come to, and who is in a position to have said so. */
type Expectation = { digest: Sha256Digest; saidBy: 'caller' | 'release' };

/** A digest somebody said the url would serve, and what it turned out to serve. */
type DigestCheck = { expected: Expectation; served: Promise<Sha256Digest> };

/**
 * The source, hashed on its way past where there is something to hold it to. Untouched where
 * there is not: reading a download to the end is the cost of checking one, and nobody who did not
 * ask for the check should pay it.
 */
function checking({
  source,
  expected,
}: {
  source: ReadableStream<Uint8Array>;
  expected: Expectation | undefined;
}): { body: ReadableStream<Uint8Array>; check: DigestCheck | undefined } {
  if (expected === undefined) {
    return { body: source, check: undefined };
  }
  const { body, served } = digesting({ source });
  return { body, check: { expected, served } };
}

/**
 * The download held to the digest it was promised to be.
 *
 * Against the download rather than against the executable unwrapped from it, because a release
 * publishes a checksum over the file it uploaded — a `checksums.txt` beside a zip is the zip's,
 * and nobody publishes the digest of one file inside an archive.
 */
async function heldToDigest(check: DigestCheck | undefined): Promise<void> {
  if (check === undefined) {
    return;
  }
  const served = await check.served;
  const { digest, saidBy } = check.expected;
  if (served === digest) {
    return;
  }
  const refusal = saidBy === 'caller' ? wrongDigest : wrongPublishedDigest;
  throw new BadRequestError(refusal({ expected: digest, served }));
}

function unsupportedInterpreter(interpreter: string): string {
  return `The artifact needs the dynamic loader at ${interpreter}, which the guest does not have. Link it against /lib64/ld-linux-x86-64.so.2, or compile it static.`;
}

function unsupportedMachine(machine: number): string {
  return `The artifact is built for ${describeMachine(machine)}, and apps run on x86_64. Rebuild it for linux-x64.`;
}

/** Why the bytes were refused, in the uploader's terms rather than the inspection's. */
function refusalMessage(inspection: Exclude<ArtifactInspection, { outcome: 'stored' }>): string {
  switch (inspection.outcome) {
    case 'too-large':
      return TOO_LARGE;
    case 'unsupported-machine':
      return unsupportedMachine(inspection.machine);
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
 *
 * That rule is `expire-staged-uploads` in `infra/terraform/s3.tf`, one day over the `uploads/`
 * prefix, and nothing compares the two — so shortening it there is shortening this here. Which way
 * they may differ is not symmetric: this sweep is what removes the object and the row together,
 * and the rule is the backstop for an object whose delete was refused, so a rule longer than this
 * costs nothing and a rule shorter than it is what leaves a row waiting on bytes already gone.
 */
const ABANDONED_AFTER_SECONDS = 86_400;

// One slot per upload, under the app it belongs to. The app is in the key so that a signed policy
// can only ever be spent inside the app whose ownership was checked to obtain it, and the
// artifact's own id is in it so that two uploads never write over each other.
const UPLOAD_PREFIX = 'uploads';

export type AppOwnershipRepositoryContract = Pick<AppsRepositoryContract, 'isOwnedBy'>;

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
    originalFileUrl: row.original_file_url ?? undefined,
    createdAt: toTimestamp(row.created_at),
  };
}

export class ArtifactsService extends Service {
  private readonly artifactsRepo: ArtifactsRepositoryContract;
  private readonly storageRepo: ArtifactStorageRepositoryContract;
  private readonly sourceRepo: RemoteSourceRepositoryContract;
  private readonly cachedRepo: CachedBinariesRepositoryContract;
  private readonly releaseRepo: ReleaseDigestRepositoryContract;
  private readonly appsRepo: AppOwnershipRepositoryContract;
  private readonly fetchSlots: RemoteFetchSlots;

  constructor({
    artifactsRepo,
    storageRepo,
    sourceRepo,
    cachedRepo,
    releaseRepo,
    appsRepo,
    fetchSlots,
  }: {
    artifactsRepo: ArtifactsRepositoryContract;
    storageRepo: ArtifactStorageRepositoryContract;
    sourceRepo: RemoteSourceRepositoryContract;
    cachedRepo: CachedBinariesRepositoryContract;
    releaseRepo: ReleaseDigestRepositoryContract;
    appsRepo: AppOwnershipRepositoryContract;
    fetchSlots: RemoteFetchSlots;
  }) {
    super();
    this.artifactsRepo = artifactsRepo;
    this.storageRepo = storageRepo;
    this.sourceRepo = sourceRepo;
    this.cachedRepo = cachedRepo;
    this.releaseRepo = releaseRepo;
    this.appsRepo = appsRepo;
    this.fetchSlots = fetchSlots;
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
    deploymentGrant,
    isAnonymous,
    filename,
    sizeBytes,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    deploymentGrant: ArtifactUploadGrant | null;
    isAnonymous: boolean;
    filename: Filename;
    sizeBytes: number;
  }): Promise<ArtifactUpload> {
    if (!(await this.appsRepo.isOwnedBy({ appId, ownerId }))) {
      throw new NotFoundError(NO_SUCH_APP);
    }
    if (sizeBytes > MAX_ARTIFACT_SIZE_BYTES) {
      throw new BadRequestError(TOO_LARGE);
    }

    const pending = takenPlace(
      await this.artifactsRepo.insertPending({
        appId,
        ownerId,
        originalFileName: filename,
        originalFileUrl: null,
        sourceDigest: null,
        onlyOne: isAnonymous,
      }),
    );

    const url = await this.storageRepo.signUpload({
      expiresAt: deploymentGrant?.expires_at ?? null,
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
      return await this.alreadyStored({ appId, artifactId, ownerId });
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
   *
   * A caller who knows what the url should be serving may say so, and what is held to it is the
   * download itself — the file a release published a checksum for. It can only be checked once
   * the bytes are read, so a url serving something else costs the fetch; what it does not cost is
   * a deploy of whatever turned up.
   */
  async createFromUrl(input: FetchArtifactInput): Promise<Artifact> {
    const diagnostics = new DownloadDiagnostics({
      logger: this.logger,
      fields: { appId: input.appId, origin: downloadOrigin(input.url) },
    });
    return await diagnostics.phase({
      phase: 'artifact',
      run: () => this.fetchFromUrl({ ...input, diagnostics }),
      result: (artifact) => ({ artifactId: artifact.id, sizeBytes: artifact.sizeBytes }),
    });
  }

  private async fetchFromUrl({
    appId,
    ownerId,
    deploymentGrant,
    isAnonymous,
    url,
    filename: providedFilename,
    sha256,
    diagnostics,
  }: FetchArtifactInput & { diagnostics: DownloadDiagnostics }): Promise<Artifact> {
    if (deploymentGrant !== null) {
      throw new ForbiddenError('Deployment grants can only upload binaries.');
    }
    if (
      !(await diagnostics.phase({
        phase: 'ownership',
        run: () => this.appsRepo.isOwnedBy({ appId, ownerId }),
      }))
    ) {
      throw new NotFoundError(NO_SUCH_APP);
    }

    // Temporary file download URLs may not carry a filename in their path.
    const filename = providedFilename ?? filenameFromUrl(url);
    if (filename === undefined) {
      throw new BadRequestError(UNNAMED_BINARY);
    }
    const said = withoutCredentials(url);
    const expected = await diagnostics.phase({
      phase: 'checksum-lookup',
      run: () => this.expected({ url, sha256 }),
      result: (expectation) => ({ source: expectation?.saidBy ?? 'unknown' }),
    });
    // Written down only where the bytes are this api's to hand on. A download reached with a
    // password is the caller's own, and a digest is all anybody would need to ask for it by.
    const sourceDigest =
      expected !== undefined && !carriesCredentials(url) ? expected.digest : null;

    const onlyOne = isAnonymous;
    const reused = await this.reuse({
      appId,
      ownerId,
      onlyOne,
      url: said,
      sourceDigest,
      diagnostics,
    });
    if (reused) {
      return reused;
    }

    // Counted only against a fetch that is going to happen. A release everyone is deploying would
    // otherwise spend the slots it no longer needs, and turn its own popularity into the one
    // answer nobody can act on.
    this.fetchSlots.take(ownerId);
    try {
      return await this.fetchInto({
        appId,
        ownerId,
        onlyOne,
        url,
        said,
        filename,
        expected,
        sourceDigest,
        diagnostics,
      });
    } finally {
      this.fetchSlots.release(ownerId);
    }
  }

  /**
   * What the download should come to, from whoever is in a position to say.
   *
   * The caller first, always: a checksum in a link was put there by somebody who knows what they
   * published, and going and asking elsewhere would be second-guessing them. Where they said
   * nothing, the release host's own word about its asset — which is what makes a link nobody wrote
   * a checksum into exact anyway, and exact is the whole of what lets one be reused.
   *
   * It is also the difference between a hashless link being deployed unverified and being held to
   * something: until now there was nothing to check such a download against.
   */
  private async expected({
    url,
    sha256,
  }: {
    url: string;
    sha256: Sha256Digest | undefined;
  }): Promise<Expectation | undefined> {
    if (sha256 !== undefined) {
      return { digest: sha256, saidBy: 'caller' };
    }
    const published = await this.releaseRepo.publishedDigest({ url });
    if (published.outcome === 'published') {
      return { digest: published.digest, saidBy: 'release' };
    }

    this.saidNothing({ url, published });
    return undefined;
  }

  /**
   * A release that gave no digest, said out loud only where somebody could act on it.
   *
   * Being rate limited is this whole feature switched off — every hashless link goes back to being
   * fetched unverified — and it is indistinguishable from a quiet afternoon unless it is said. The
   * quota is sixty an hour for a caller with no token, so the sentence names the way out of it.
   *
   * The other two outcomes are the ordinary shape of the world: most urls are not releases, and
   * every release published before GitHub began computing digests has none.
   */
  private saidNothing({ url, published }: { url: string; published: PublishedDigest }): void {
    if (published.outcome === 'rate-limited') {
      this.logger.warn(
        'the release api is rate limiting nibrun, so binaries fetched from it go unverified and are not reused. A GitHub token raises the quota from 60 an hour to 5000.',
        { origin: downloadOrigin(url), until: published.until },
      );
      return;
    }
    if (published.outcome === 'unavailable') {
      this.logger.info('the release api said nothing about this url', {
        origin: downloadOrigin(url),
      });
    }
  }

  /**
   * The artifact a url does not have to be followed for, where this api already holds what it
   * serves and has watched it run.
   *
   * Only ever reached with a digest the caller brought, which is what makes the answer exact: the
   * bytes are named by what they hash to rather than by where they were found, so this cannot
   * hand back yesterday's release to a url that has since been rebuilt. A url nobody vouched for
   * is fetched, every time — see `cached_binaries` for what it takes to get into it.
   *
   * The object is asked after because the view is a row and the bytes are not: an app purged
   * between the two leaves a key nothing answers, and a deploy pointed at one would fail on the
   * host rather than here. A miss costs one HEAD and the download that was going to happen anyway.
   */
  private async reuse({
    appId,
    ownerId,
    onlyOne,
    url,
    sourceDigest,
    diagnostics,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    onlyOne: boolean;
    url: string;
    sourceDigest: Sha256Digest | null;
    diagnostics: DownloadDiagnostics;
  }): Promise<Artifact | undefined> {
    if (sourceDigest === null) {
      return undefined;
    }
    const cached = await diagnostics.phase({
      phase: 'cache-lookup',
      run: () => this.cachedRepo.findBySourceDigest({ sourceDigest }),
      result: (row) => ({ hit: row !== null }),
    });
    if (
      !cached ||
      !(await diagnostics.phase({
        phase: 'cache-object-head',
        run: () => this.storageRepo.exists({ objectKey: cached.object_key }),
        result: (exists) => ({ exists }),
      }))
    ) {
      return undefined;
    }

    return await diagnostics.phase({
      phase: 'cache-register',
      run: () => this.stored({ appId, ownerId, onlyOne, url, cached }),
    });
  }

  /**
   * The cached binary written down as this app's own artifact. A row per app either way: what is
   * shared is the object, which is what being content-addressed has always meant here.
   *
   * The name comes from the cached row rather than from the url, because it is the name the
   * binary actually has — an executable unwrapped from an archive is only ever named by the walk
   * that found it, and the same download unwraps the same way every time.
   */
  private async stored({
    appId,
    ownerId,
    onlyOne,
    url,
    cached,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    onlyOne: boolean;
    url: string;
    cached: CachedBinaryRow;
  }): Promise<Artifact> {
    const pending = takenPlace(
      await this.artifactsRepo.insertPending({
        appId,
        ownerId,
        originalFileName: cached.original_file_name,
        originalFileUrl: url,
        sourceDigest: cached.source_digest,
        onlyOne,
      }),
    );

    const stored = await this.artifactsRepo.complete({
      appId,
      artifactId: pending.id,
      ownerId,
      digest: cached.digest,
      sizeBytes: Number(cached.size_bytes),
      objectKey: cached.object_key,
    });

    return stored
      ? toArtifact(stored)
      : await this.alreadyStored({ appId, artifactId: pending.id, ownerId });
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
    onlyOne,
    url,
    said,
    filename,
    expected,
    sourceDigest,
    diagnostics,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    onlyOne: boolean;
    url: string;
    said: string;
    filename: Filename;
    expected: Expectation | undefined;
    sourceDigest: Sha256Digest | null;
    diagnostics: DownloadDiagnostics;
  }): Promise<Artifact> {
    const source = await diagnostics.phase({
      phase: 'source',
      run: () => this.sourceRepo.open({ url, diagnostics }),
      result: (opened) => ({ outcome: opened.outcome }),
    });
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
    // a source that declares none is otherwise read for as long as it keeps sending. The bound is
    // on what the url sent rather than on what it came to, which for an archive is not the same.
    const bounded = boundedTo({ source: source.body, maxSizeBytes: MAX_ARTIFACT_SIZE_BYTES });
    const { body: fetched, check } = checking({ source: bounded, expected });
    const held = await diagnostics.phase({
      phase: 'unpack',
      run: () => unwrapped({ source: fetched, named: filename, url: said }),
    });

    const inserted = await diagnostics.phase({
      phase: 'pending-artifact',
      run: () =>
        this.artifactsRepo.insertPending({
          appId,
          ownerId,
          originalFileName: held.filename,
          originalFileUrl: said,
          sourceDigest,
          onlyOne,
        }),
      result: (pending) => ({ outcome: pending.outcome }),
    });
    if (inserted.outcome !== 'created') {
      await release(held.body);
    }
    const pending = takenPlace(inserted);

    const staged = stagingKey({ appId, artifactId: pending.id });
    const inspection = await this.stageOrGiveUp({
      appId,
      artifactId: pending.id,
      ownerId,
      staged,
      body: held.body,
      url: said,
      check,
      diagnostics,
    });

    return await this.promote({
      appId,
      artifactId: pending.id,
      ownerId,
      staged,
      inspection,
      diagnostics,
    });
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
    check,
    diagnostics,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
    staged: ObjectKey;
    body: ReadableStream<Uint8Array>;
    url: string;
    check: DigestCheck | undefined;
    diagnostics: DownloadDiagnostics;
  }): Promise<ArtifactInspection> {
    try {
      const inspection = await diagnostics.phase({
        phase: 'storage-upload',
        run: () => this.stage({ staged, body }),
        result: (inspected) => ({ outcome: inspected.outcome }),
      });
      await diagnostics.phase({ phase: 'source-checksum', run: () => heldToDigest(check) });
      return inspection;
    } catch (failure) {
      await diagnostics.phase({
        phase: 'abandon',
        run: () => this.abandon({ appId, artifactId, ownerId }),
      });
      if (failure instanceof InterruptedSourceError) {
        throw new BadRequestError(interruptedSource(url));
      }
      // A source held to a length it went past, which is the caller's url rather than this api
      // in exactly the way a 404 from it would be.
      if (failure instanceof ArtifactTooLargeError) {
        throw new BadRequestError(TOO_LARGE);
      }
      // The archive was still being walked as the executable inside it was written, so one that
      // turns out not to hold what its headers said reaches this end as the write failing.
      if (failure instanceof UnreadableArchiveError) {
        throw new BadRequestError(unreadableArchive(url));
      }
      // A gzip handed on rather than walked is decompressed as it is written, so one holding far
      // more than it sent is found here rather than by the walk that never looked inside it.
      if (failure instanceof ExpandsTooFarError) {
        throw new BadRequestError(EXPANDS_TOO_FAR);
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
    diagnostics = new DownloadDiagnostics({ logger: this.logger, fields: { appId, artifactId } }),
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
    staged: ObjectKey;
    inspection: ArtifactInspection;
    diagnostics?: DownloadDiagnostics;
  }): Promise<Artifact> {
    if (inspection.outcome !== 'stored') {
      await this.abandon({ appId, artifactId, ownerId });
      throw new BadRequestError(refusalMessage(inspection));
    }

    const { digest, sizeBytes, objectKey } = inspection;
    if (
      !(await diagnostics.phase({
        phase: 'artifact-object-head',
        run: () => this.storageRepo.exists({ objectKey }),
        result: (exists) => ({ exists }),
      }))
    ) {
      await diagnostics.phase({
        phase: 'storage-copy',
        run: () => this.storageRepo.copy({ from: staged, to: objectKey }),
      });
    }

    const stored = await diagnostics.phase({
      phase: 'artifact-register',
      run: () =>
        this.artifactsRepo.complete({
          appId,
          artifactId,
          ownerId,
          digest,
          sizeBytes,
          objectKey,
        }),
    });

    await diagnostics.phase({
      phase: 'staging-cleanup',
      run: () => this.discard({ objectKey: staged }),
    });

    // The write is what settles a race between two completions of the same row: the one whose
    // update matched nothing is looking at the other's artifact, not at a missing one.
    return stored ? toArtifact(stored) : await this.alreadyStored({ appId, artifactId, ownerId });
  }

  /**
   * A completion for a row that is no longer waiting for one. The digest is what makes a row an
   * artifact, so a row that has one is an upload that landed, and a caller repeating itself is
   * asking for the state the row is already in — answered with the artifact rather than refused,
   * because a retry is how a completion that was slow enough to be sent twice comes back.
   *
   * Still not found where no such row is theirs at all: an id naming no upload of the caller's is
   * the one case where nothing was stored under it.
   */
  private async alreadyStored({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<Artifact> {
    const stored = await this.artifactsRepo.findById({ appId, artifactId, ownerId });
    if (!stored) {
      throw new NotFoundError(NO_SUCH_UPLOAD);
    }
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

/**
 * The source as the binary it holds: its own bytes, or the executable inside the archive they turn
 * out to be. A project that publishes its build packed is publishing a url nobody could deploy from
 * otherwise — the alternative is downloading it, unpacking it, and uploading the one file inside.
 *
 * The entry names the artifact where it can, because it is the name the binary actually has: a url
 * ending in `.tar.gz` would otherwise be what an export writes the executable out as.
 */
async function unwrapped({
  source,
  named,
  url,
}: {
  source: ReadableStream<Uint8Array>;
  named: Filename;
  url: string;
}): Promise<{ body: ReadableStream<Uint8Array>; filename: Filename }> {
  const unwrapping = await walked({ source, url });

  switch (unwrapping.outcome) {
    case 'not-an-archive':
      return { body: unwrapping.body, filename: unpacked(named) };
    case 'unwrapped':
      return { body: unwrapping.body, filename: entryName(unwrapping.name) ?? unpacked(named) };
    case 'no-executable':
      throw new BadRequestError(NOTHING_EXECUTABLE);
    case 'walked-too-far':
      throw new BadRequestError(WALKED_TOO_FAR);
    case 'entry-too-large':
      throw new BadRequestError(ENTRY_TOO_LARGE);
    case 'expands-too-far':
      throw new BadRequestError(EXPANDS_TOO_FAR);
    case 'unreadable':
      throw new BadRequestError(unreadableArchive(url));
  }
}

/** The walk, with the two ways it can fail said in the caller's terms rather than the walker's. */
async function walked({
  source,
  url,
}: {
  source: ReadableStream<Uint8Array>;
  url: string;
}): Promise<Unwrapping> {
  try {
    return await unwrapExecutable({ archive: source, maxSkippedBytes: MAX_ARTIFACT_SIZE_BYTES });
  } catch (failure) {
    if (failure instanceof InterruptedSourceError) {
      throw new BadRequestError(interruptedSource(url));
    }
    if (failure instanceof ArtifactTooLargeError) {
      throw new BadRequestError(TOO_LARGE);
    }
    throw failure;
  }
}

/** The entry's name where it is one an export could carry, and nothing where it is not. */
function entryName(name: string): Filename | undefined {
  return Value.Check(FilenameSchema, name) ? name : undefined;
}

/**
 * The suffixes that name what the bytes arrived in rather than what they are. Longest first, so a
 * `.tar.gz` is not read as a `.gz` of something called `.tar`.
 */
const CONTAINER_SUFFIXES = ['.tar.gz', '.tgz', '.tar', '.zip', '.gz'];

/**
 * The url's own name with the container taken off it. What is stored is always the bare executable
 * — everything else is refused — so a url ending in one of these is describing the download, and an
 * export that wrote it back out would name a binary after the archive it stopped being.
 */
function unpacked(named: Filename): Filename {
  const suffix = CONTAINER_SUFFIXES.find((candidate) => named.endsWith(candidate));
  return (suffix === undefined ? undefined : entryName(named.slice(0, -suffix.length))) ?? named;
}

/** A body nobody is going to read holds its connection open until it is let go of. */
async function release(body: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await body.cancel();
  } catch {
    return;
  }
}

/**
 * A place that was not taken is one of two refusals, and they are told apart by what the caller
 * can do: an app that is not theirs is one that does not exist, while an app that already holds
 * its one binary is theirs to keep by signing in.
 */
function takenPlace(inserted: PendingArtifactInsert): PendingArtifactRow {
  if (inserted.outcome === 'held') {
    throw new ForbiddenError(ONE_BINARY);
  }
  if (inserted.outcome === 'no-app') {
    throw new NotFoundError(NO_SUCH_APP);
  }
  return inserted.row;
}

function stagingKey({ appId, artifactId }: { appId: AppId; artifactId: ArtifactId }): ObjectKey {
  return Value.Parse(ObjectKeySchema, `${UPLOAD_PREFIX}/${appId}/${artifactId}`);
}

import { describe, expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import {
  type AppId,
  type ArtifactId,
  ArtifactIdSchema,
  ArtifactSchema,
  type Filename,
  FilenameSchema,
  isValidMessage,
  type ObjectKey,
  ObjectKeySchema,
  type OwnerId,
  type Sha256Digest,
  Sha256DigestSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { MAX_EXPANSION } from '#lib/archive/walk.ts';
import { BadRequestError, NotFoundError, TooManyRequestsError } from '#lib/errors.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  AbandonedArtifactRow,
  ArtifactRow,
  ArtifactsRepositoryContract,
  CompleteArtifactInput,
  InsertPendingArtifactInput,
  PendingArtifactRow,
} from '#repositories/artifacts.repository.ts';
import {
  type BinarySource,
  type BinarySourceRepositoryContract,
  InterruptedSourceError,
} from '#repositories/binary-source.repository.ts';
import type {
  CachedBinariesRepositoryContract,
  CachedBinaryRow,
} from '#repositories/cached-binaries.repository.ts';
import type {
  PublishedDigest,
  ReleaseDigestRepositoryContract,
} from '#repositories/release-digest.repository.ts';
import {
  type AppOwnership,
  ArtifactsService,
  MAX_ARTIFACT_SIZE_BYTES,
  MAX_CONCURRENT_FETCHES,
} from '#services/artifacts.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { archiveOf } from '#tests/support/archives.ts';
import { expandsTooFar, incompressible } from '#tests/support/downloads.ts';
import { gzippedTarballOf } from '#tests/support/tarballs.ts';

// The api refuses anything that is not a Linux executable, so the fixture opens with the ELF
// magic the way a real upload does.
const BINARY_TEXT = '\x7fELFnibrun-test-binary';
const BINARY_DIGEST = 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298';
const UPLOADED_NAME = Value.Parse(FilenameSchema, 'pocketbase');

const SEEDED_DIGEST = Value.Parse(Sha256DigestSchema, 'a'.repeat(BINARY_DIGEST.length));
const SEEDED_SIZE_BYTES = 4096;
const SEEDED_CREATED_AT = new Date('2026-01-02T03:04:05.000Z');

const A_DAY_SECONDS = 86_400;
const AN_HOUR_MS = 3_600_000;
const MS_PER_SECOND = 1_000;
const PAST_THE_SWEEP_MS = A_DAY_SECONDS * MS_PER_SECOND + AN_HOUR_MS;

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/** What a release would publish beside the file: the digest of the file, whatever is inside it. */
function digestOf(bytes: Uint8Array): Sha256Digest {
  return Value.Parse(
    Sha256DigestSchema,
    new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
  );
}

type StoredRow = Omit<ArtifactRow, 'digest' | 'size_bytes' | 'object_key'> & {
  digest: ArtifactRow['digest'] | null;
  size_bytes: ArtifactRow['size_bytes'] | null;
  object_key: ArtifactRow['object_key'] | null;
  // Not on `ArtifactRow`, which is what a caller is shown: where the bytes were found is the
  // control plane's own record, and the digest they were held to is read only by the view.
  source_digest: Sha256Digest | null;
};

/**
 * A row is an artifact once it has a digest and an upload still in flight until then, which is
 * the distinction the SQL draws — so this fake draws it too rather than answering every read the
 * same way and leaving the service to sort them out.
 */
class FakeArtifactsRepository implements ArtifactsRepositoryContract {
  readonly rows = new Map<ArtifactId, StoredRow>();
  private readonly ownedBy: OwnerId;
  private refuses = false;

  constructor(ownedBy: OwnerId) {
    this.ownedBy = ownedBy;
  }

  /** The app went while the fetch was being opened, which is the one way a row fails to begin. */
  refusesToInsert(): void {
    this.refuses = true;
  }

  insertPending({
    appId,
    ownerId,
    originalFileName,
    originalFileUrl,
    sourceDigest,
  }: InsertPendingArtifactInput): Promise<PendingArtifactRow | null> {
    if (ownerId !== this.ownedBy || this.refuses) {
      return Promise.resolve(null);
    }
    const row: StoredRow = {
      id: Value.Parse(ArtifactIdSchema, `artifact-${this.rows.size}`),
      app_id: appId,
      digest: null,
      size_bytes: null,
      object_key: null,
      original_file_name: originalFileName,
      original_file_url: originalFileUrl,
      source_digest: sourceDigest,
      created_at: SEEDED_CREATED_AT,
    };
    this.rows.set(row.id, row);
    return Promise.resolve({
      id: row.id,
      app_id: row.app_id,
      original_file_name: row.original_file_name,
      original_file_url: row.original_file_url,
      created_at: row.created_at,
    });
  }

  complete({
    appId,
    artifactId,
    ownerId,
    digest,
    sizeBytes,
    objectKey,
  }: CompleteArtifactInput): Promise<ArtifactRow | null> {
    const row = this.rows.get(artifactId);
    if (!row || row.app_id !== appId || ownerId !== this.ownedBy || row.digest !== null) {
      return Promise.resolve(null);
    }
    const completed: StoredRow = {
      ...row,
      digest,
      size_bytes: String(sizeBytes),
      object_key: objectKey,
    };
    this.rows.set(artifactId, completed);
    return Promise.resolve(completed as ArtifactRow);
  }

  remove({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<void> {
    const row = this.rows.get(artifactId);
    if (row && row.app_id === appId && ownerId === this.ownedBy && row.digest === null) {
      this.rows.delete(artifactId);
    }
    return Promise.resolve();
  }

  findPending({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<PendingArtifactRow | null> {
    const row = this.rows.get(artifactId);
    if (!row || row.app_id !== appId || ownerId !== this.ownedBy || row.digest !== null) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      id: row.id,
      app_id: row.app_id,
      original_file_name: row.original_file_name,
      original_file_url: row.original_file_url,
      created_at: row.created_at,
    });
  }

  listAbandoned({
    olderThanSeconds,
  }: {
    olderThanSeconds: number;
  }): Promise<AbandonedArtifactRow[]> {
    const cutoff = Date.now() - olderThanSeconds * MS_PER_SECOND;
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.digest === null && row.created_at.getTime() < cutoff)
        .map((row) => ({ id: row.id, app_id: row.app_id })),
    );
  }

  removeAbandoned({ artifactId }: { artifactId: ArtifactId }): Promise<void> {
    if (this.rows.get(artifactId)?.digest === null) {
      this.rows.delete(artifactId);
    }
    return Promise.resolve();
  }

  listByApp({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]> {
    if (ownerId !== this.ownedBy) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) => row.app_id === appId && row.digest !== null,
      ) as ArtifactRow[],
    );
  }

  findById({
    appId,
    artifactId,
    ownerId,
  }: {
    appId: AppId;
    artifactId: ArtifactId;
    ownerId: OwnerId;
  }): Promise<ArtifactRow | null> {
    const row = this.rows.get(artifactId);
    if (!row || row.app_id !== appId || ownerId !== this.ownedBy || row.digest === null) {
      return Promise.resolve(null);
    }
    return Promise.resolve(row as ArtifactRow);
  }

  seed(): ArtifactRow {
    const row: StoredRow = {
      id: Value.Parse(ArtifactIdSchema, `artifact-${this.rows.size}`),
      app_id: APP_ID,
      digest: SEEDED_DIGEST,
      size_bytes: String(SEEDED_SIZE_BYTES),
      object_key: Value.Parse(ObjectKeySchema, SEEDED_DIGEST),
      original_file_name: UPLOADED_NAME,
      original_file_url: null,
      source_digest: null,
      created_at: SEEDED_CREATED_AT,
    };
    this.rows.set(row.id, row);
    return row as ArtifactRow;
  }

  age({ artifactId, byMs }: { artifactId: ArtifactId; byMs: number }): void {
    const row = this.rows.get(artifactId);
    if (row) {
      this.rows.set(artifactId, { ...row, created_at: new Date(Date.now() - byMs) });
    }
  }
}

const SIGNED_URL = 'https://store.test/nibrun';

/** A bucket as a map, so what a signed upload wrote and what the api copied are both visible. */
class FakeStorage implements ArtifactStorageRepositoryContract {
  readonly objects = new Map<ObjectKey, Uint8Array>();
  readonly signed: { objectKey: ObjectKey; sizeBytes: number }[] = [];
  readonly copied: { from: ObjectKey; to: ObjectKey }[] = [];

  signUpload(input: { objectKey: ObjectKey; sizeBytes: number }): Promise<string> {
    this.signed.push(input);
    return Promise.resolve(`${SIGNED_URL}/${input.objectKey}`);
  }

  async write({
    objectKey,
    body,
  }: {
    objectKey: ObjectKey;
    body: ReadableStream<Uint8Array>;
  }): Promise<void> {
    const written: number[] = [];
    for await (const chunk of body) {
      written.push(...chunk);
    }
    this.objects.set(objectKey, Uint8Array.from(written));
  }

  read({ objectKey }: { objectKey: ObjectKey }): ReadableStream<Uint8Array> {
    const bytes = this.objects.get(objectKey);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes !== undefined) {
          controller.enqueue(bytes);
        }
        controller.close();
      },
    });
  }

  copy({ from, to }: { from: ObjectKey; to: ObjectKey }): Promise<void> {
    this.copied.push({ from, to });
    const bytes = this.objects.get(from);
    if (bytes !== undefined) {
      this.objects.set(to, bytes);
    }
    return Promise.resolve();
  }

  exists({ objectKey }: { objectKey: ObjectKey }): Promise<boolean> {
    return Promise.resolve(this.objects.has(objectKey));
  }

  remove({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }

  /** Stands in for the caller spending the signed url. */
  put({ objectKey, text }: { objectKey: ObjectKey; text: string }): void {
    this.objects.set(objectKey, bytesOf(text));
  }
}

const BUCKET_REFUSED = 'the bucket said no';

class RefusingStorage extends FakeStorage {
  override copy(): Promise<void> {
    return Promise.reject(new Error(BUCKET_REFUSED));
  }
}

const appsRepo: AppOwnership = {
  isOwnedBy: ({ ownerId }) => Promise.resolve(ownerId === OWNER_ID),
};

/** The url as whatever it answers with, so what a fetch runs into is set by the test asking. */
class FakeBinarySource implements BinarySourceRepositoryContract {
  readonly opened: string[] = [];
  private answer: BinarySource = { outcome: 'unreachable' };
  private gate: PromiseWithResolvers<void> | undefined;
  private letGo = false;

  async open({ url }: { url: string }): Promise<BinarySource> {
    this.opened.push(url);
    await this.gate?.promise;
    return this.answer;
  }

  answers(source: BinarySource): void {
    this.answer = source;
  }

  serves({ text, declaredSizeBytes }: { text: string; declaredSizeBytes?: number }): void {
    this.servesBytes({ bytes: bytesOf(text), declaredSizeBytes });
  }

  /**
   * `chunkBytes` is what makes a download arrive rather than appear. A body handed over whole is
   * one whoever reads it has already finished with, which is no way to find out what happens to
   * the rest of a download somebody stopped reading.
   */
  servesBytes({
    bytes,
    declaredSizeBytes,
    chunkBytes,
  }: {
    bytes: Uint8Array;
    declaredSizeBytes?: number;
    chunkBytes?: number;
  }): void {
    this.answers({
      outcome: 'open',
      body: streamOf({
        bytes,
        chunkBytes,
        onCancel: () => {
          this.letGo = true;
        },
      }),
      declaredSizeBytes,
    });
  }

  /** A body with no end to it, which is what a source that has to be let go of looks like. */
  keepsSending(): void {
    this.answers({
      outcome: 'open',
      body: new ReadableStream<Uint8Array>({
        pull: (controller) => {
          controller.enqueue(bytesOf(BINARY_TEXT));
        },
        cancel: () => {
          this.letGo = true;
        },
      }),
      declaredSizeBytes: undefined,
    });
  }

  /** A body that arrives in part and then does not, which is a download interrupted. */
  stopsPartWay(): void {
    this.answers({ outcome: 'open', body: stoppingPartWay(), declaredSizeBytes: undefined });
  }

  /** Every fetch waits where it is until the returned function is called. */
  holdsOpen(): () => void {
    const gate = Promise.withResolvers<void>();
    this.gate = gate;
    return () => {
      gate.resolve();
    };
  }

  /** Whether a body handed over and then not wanted was let go of rather than left open. */
  get wasLetGo(): boolean {
    return this.letGo;
  }
}

function streamOf({
  bytes,
  chunkBytes,
  onCancel,
}: {
  bytes: Uint8Array;
  chunkBytes?: number;
  onCancel?: () => void;
}): ReadableStream<Uint8Array> {
  const step = chunkBytes ?? bytes.byteLength;
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(at, at + step));
      at += step;
    },
    cancel() {
      onCancel?.();
    },
  });
}

function stoppingPartWay(): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new InterruptedSourceError(new Error('the source went away')));
        return;
      }
      sent = true;
      controller.enqueue(bytesOf(BINARY_TEXT));
    },
  });
}

/**
 * What `nibrun.cached_binaries` answers, as a map. Empty unless a test puts something in it: a
 * download nobody has deployed is the ordinary case, and every other test here expects the fetch
 * to happen.
 */
class FakeCachedBinaries implements CachedBinariesRepositoryContract {
  readonly rows = new Map<Sha256Digest, CachedBinaryRow>();
  readonly asked: Sha256Digest[] = [];

  remember(row: CachedBinaryRow): void {
    this.rows.set(row.source_digest, row);
  }

  findBySourceDigest({
    sourceDigest,
  }: {
    sourceDigest: Sha256Digest;
  }): Promise<CachedBinaryRow | null> {
    this.asked.push(sourceDigest);
    return Promise.resolve(this.rows.get(sourceDigest) ?? null);
  }
}

/**
 * What a release host says about its own asset. Says nothing unless a test gives it something,
 * which is also what an unreachable or rate-limited api answers with.
 */
class FakeReleaseDigests implements ReleaseDigestRepositoryContract {
  readonly asked: string[] = [];
  private answer: PublishedDigest = { outcome: 'not-a-release' };

  publishes(digest: Sha256Digest): void {
    this.answer = { outcome: 'published', digest };
  }

  answers(answer: PublishedDigest): void {
    this.answer = answer;
  }

  publishedDigest({ url }: { url: string }): Promise<PublishedDigest> {
    this.asked.push(url);
    return Promise.resolve(this.answer);
  }
}

function build(storageRepo: FakeStorage = new FakeStorage()) {
  const artifactsRepo = new FakeArtifactsRepository(OWNER_ID);
  const sourceRepo = new FakeBinarySource();
  const cachedRepo = new FakeCachedBinaries();
  const releaseRepo = new FakeReleaseDigests();
  return {
    storage: storageRepo,
    artifactsRepo,
    sourceRepo,
    cachedRepo,
    releaseRepo,
    service: new ArtifactsService({
      artifactsRepo,
      storageRepo,
      sourceRepo,
      cachedRepo,
      releaseRepo,
      appsRepo,
    }),
  };
}

/** Create the artifact, put the bytes where it points, and say so — one deploy's worth. */
async function upload({
  service,
  storage,
  text = BINARY_TEXT,
  ownerId = OWNER_ID,
  filename = UPLOADED_NAME,
}: {
  service: ArtifactsService;
  storage: FakeStorage;
  text?: string;
  ownerId?: OwnerId;
  filename?: Filename;
}) {
  const { artifactId } = await service.create({
    appId: APP_ID,
    ownerId,
    filename,
    sizeBytes: text.length,
  });
  storage.put({ objectKey: (storage.signed.at(-1) as { objectKey: ObjectKey }).objectKey, text });
  return service.completeUpload({ appId: APP_ID, ownerId, artifactId });
}

describe('an artifact begins before its bytes do', () => {
  test('the slot is inside the app it belongs to, so a url cannot be spent anywhere else', async () => {
    const { service, storage } = build();

    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });

    expect(storage.signed.at(-1)?.objectKey).toBe(
      Value.Parse(ObjectKeySchema, `uploads/${APP_ID}/${artifactId}`),
    );
  });

  // The store is the only thing positioned to refuse the bytes as they arrive, and it will only
  // do it if the size is part of what was signed.
  test('the url is signed for the size that was declared', async () => {
    const { service, storage } = build();

    await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });

    expect(storage.signed.at(-1)?.sizeBytes).toBe(BINARY_TEXT.length);
  });

  test('two uploads of one app never share a slot', async () => {
    const { service, storage } = build();
    const input = {
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    };

    const first = await service.create(input);
    const second = await service.create(input);

    expect(second.artifactId).not.toBe(first.artifactId);
    expect(new Set(storage.signed.map((entry) => entry.objectKey)).size).toBe(2);
  });

  test('a binary declared over the limit is refused before a row or a url exists', async () => {
    const { service, storage, artifactsRepo } = build();

    await expect(
      service.create({
        appId: APP_ID,
        ownerId: OWNER_ID,
        filename: UPLOADED_NAME,
        sizeBytes: MAX_ARTIFACT_SIZE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(storage.signed).toEqual([]);
    expect(artifactsRepo.rows.size).toBe(0);
  });

  test('creating one in an app the caller does not own is refused', async () => {
    const { service, storage } = build();

    await expect(
      service.create({
        appId: APP_ID,
        ownerId: OTHER_OWNER_ID,
        filename: UPLOADED_NAME,
        sizeBytes: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(storage.signed).toEqual([]);
  });

  // Until the bytes are read there is nothing to deploy and nothing worth listing.
  test('one still waiting for its upload is not an artifact anybody can see', async () => {
    const { service, artifactsRepo } = build();

    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });

    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([]);
    await expect(
      service.get({ appId: APP_ID, artifactId, ownerId: OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(artifactsRepo.rows.size).toBe(1);
  });
});

describe('the api records the digest of what was stored', () => {
  test('the digest is taken from the bytes that arrived, not from what was claimed', async () => {
    const { service, storage } = build();

    const artifact = await upload({ service, storage });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifact.sizeBytes).toBe(BINARY_TEXT.length);
    expect(storage.objects.get(artifact.objectKey)).toEqual(bytesOf(BINARY_TEXT));
  });

  test('the name is the caller’s, because a content-addressed key carries none', async () => {
    const { service, storage } = build();
    const filename = Value.Parse(FilenameSchema, 'openclaw');

    expect((await upload({ service, storage, filename })).originalFileName).toBe(filename);
  });

  test('the key is derived, so two uploads of one binary share the bytes but not the row', async () => {
    const { service, storage } = build();

    const first = await upload({ service, storage });
    const second = await upload({ service, storage });

    expect(second.objectKey).toBe(first.objectKey);
    expect(second.id).not.toBe(first.id);
  });

  // Copying them again would move bytes the store already holds under exactly this key.
  test('bytes already under the key are not copied a second time', async () => {
    const { service, storage } = build();

    await upload({ service, storage });
    const copiesAfterFirst = storage.copied.length;
    await upload({ service, storage });

    expect(storage.copied).toHaveLength(copiesAfterFirst);
  });

  test('the staging copy does not outlive the artifact it became', async () => {
    const { service, storage } = build();

    const artifact = await upload({ service, storage });

    expect([...storage.objects.keys()]).toEqual([artifact.objectKey]);
  });

  test('and only then is it something to list and deploy', async () => {
    const { service, storage } = build();

    const artifact = await upload({ service, storage });

    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([artifact]);
  });
});

describe('what the store accepted, this api still has to agree to', () => {
  // The declared content type is whatever the uploader typed. Reaching a host with something the
  // guest cannot exec turns a rejectable upload into a deploy that never converges.
  test('an upload that is not a Linux executable leaves no row and no bytes', async () => {
    const { service, storage, artifactsRepo } = build();

    await expect(upload({ service, storage, text: '#!/bin/true' })).rejects.toBeInstanceOf(
      BadRequestError,
    );

    expect(artifactsRepo.rows.size).toBe(0);
    expect([...storage.objects.keys()]).toEqual([]);
  });

  test('saying an upload landed when nothing did is not an artifact', async () => {
    const { service, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });

    await expect(
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId }),
    ).rejects.toBeInstanceOf(BadRequestError);

    // Still pending rather than gone: the caller may yet finish the upload it was signed for.
    expect(artifactsRepo.rows.size).toBe(1);
  });

  // A completion slow enough to be sent twice is how the first one comes back, so the repeat
  // answers with the binary that landed rather than a failure the caller has to redo. One row
  // either way: a second artifact here would be a second release of the same bytes.
  test('a completion said twice is the artifact it already stored', async () => {
    const { service, storage, artifactsRepo } = build();
    const artifact = await upload({ service, storage });

    const again = await service.completeUpload({
      appId: APP_ID,
      ownerId: OWNER_ID,
      artifactId: artifact.id,
    });

    expect(again).toEqual(artifact);
    expect(artifactsRepo.rows.size).toBe(1);
    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([artifact]);
  });

  // Both reads land before either write does, so the loser's update matches nothing. It is
  // looking at the winner's artifact rather than a missing one, and says so.
  test('two completions racing settle on the one artifact', async () => {
    const { service, storage, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });
    storage.put({
      objectKey: (storage.signed.at(-1) as { objectKey: ObjectKey }).objectKey,
      text: BINARY_TEXT,
    });

    const [first, second] = await Promise.all([
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId }),
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId }),
    ]);

    expect(second).toEqual(first);
    expect(artifactsRepo.rows.size).toBe(1);
  });

  test("an id naming no upload of the caller's is still not found", async () => {
    const { service, storage } = build();
    const artifact = await upload({ service, storage });

    await expect(
      service.completeUpload({ appId: APP_ID, ownerId: OTHER_OWNER_ID, artifactId: artifact.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.completeUpload({
        appId: APP_ID,
        ownerId: OWNER_ID,
        artifactId: Value.Parse(ArtifactIdSchema, 'artifact-never-created'),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // The row is what says the bytes are there, so it must not become an artifact when they are not.
  test('one that never reached its resting place stays pending', async () => {
    const { service, storage, artifactsRepo } = build(new RefusingStorage());

    await expect(upload({ service, storage })).rejects.toThrow(BUCKET_REFUSED);

    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([]);
    expect(artifactsRepo.rows.size).toBe(1);
  });
});

describe('an upload the caller gave up on does not wait to be noticed', () => {
  test('saying it failed takes the row and the bytes with it', async () => {
    const { service, storage, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });
    storage.put({
      objectKey: (storage.signed.at(-1) as { objectKey: ObjectKey }).objectKey,
      text: BINARY_TEXT,
    });

    await service.failUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId });

    expect(artifactsRepo.rows.size).toBe(0);
    expect([...storage.objects.keys()]).toEqual([]);
  });

  test('an artifact that is already one is not an upload to abandon', async () => {
    const { service, storage } = build();
    const artifact = await upload({ service, storage });

    await expect(
      service.failUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId: artifact.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('another owner cannot abandon an upload that is not theirs', async () => {
    const { service, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });

    await expect(
      service.failUpload({ appId: APP_ID, ownerId: OTHER_OWNER_ID, artifactId }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(artifactsRepo.rows.size).toBe(1);
  });
});

describe('an upload nobody ever came back about is swept', () => {
  test('one old enough that nothing can still be on its way goes', async () => {
    const { service, storage, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });
    storage.put({
      objectKey: (storage.signed.at(-1) as { objectKey: ObjectKey }).objectKey,
      text: BINARY_TEXT,
    });
    artifactsRepo.age({ artifactId, byMs: PAST_THE_SWEEP_MS });

    await service.sweepAbandoned();

    expect(artifactsRepo.rows.size).toBe(0);
    expect([...storage.objects.keys()]).toEqual([]);
  });

  test('one still within its window is left alone', async () => {
    const { service, artifactsRepo } = build();
    const { artifactId } = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: BINARY_TEXT.length,
    });
    artifactsRepo.age({ artifactId, byMs: AN_HOUR_MS });

    await service.sweepAbandoned();

    expect(artifactsRepo.rows.size).toBe(1);
  });

  test('an artifact is not an upload, however old it is', async () => {
    const { service, storage, artifactsRepo } = build();
    const artifact = await upload({ service, storage });
    artifactsRepo.age({ artifactId: artifact.id, byMs: PAST_THE_SWEEP_MS });

    await service.sweepAbandoned();

    expect((await service.list({ appId: APP_ID, ownerId: OWNER_ID })).map((one) => one.id)).toEqual(
      [artifact.id],
    );
  });
});

describe('an artifact is reachable only through an app its owner owns', () => {
  test("another owner's artifact is missing rather than forbidden", async () => {
    const { artifactsRepo, service } = build();
    const seeded = artifactsRepo.seed();

    await expect(
      service.get({ appId: APP_ID, artifactId: seeded.id, ownerId: OTHER_OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listing another owner's app yields nothing rather than its artifacts", async () => {
    const { artifactsRepo, service } = build();
    artifactsRepo.seed();

    expect(await service.list({ appId: APP_ID, ownerId: OTHER_OWNER_ID })).toEqual([]);
    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toHaveLength(1);
  });
});

describe('a row becomes the wire shape the dashboard and the agent both read', () => {
  test('a bigint size becomes a number and a Date becomes an ISO instant', async () => {
    const { artifactsRepo, service } = build();
    const seeded = artifactsRepo.seed();

    const artifact = await service.get({
      appId: APP_ID,
      artifactId: seeded.id,
      ownerId: OWNER_ID,
    });

    expect(artifact.sizeBytes).toBe(SEEDED_SIZE_BYTES);
    expect(artifact.createdAt).toBe(Value.Parse(TimestampSchema, SEEDED_CREATED_AT.toISOString()));
    expect(isValidMessage({ schema: ArtifactSchema, value: artifact })).toBe(true);
  });
});

const BINARY_URL = 'https://releases.test/v1/my-server';
const ARCHIVE_URL = 'https://releases.test/v1/my-server_1.2.3_linux_amd64.zip';
const TARBALL_URL = 'https://releases.test/v1/my-server_1.2.3_linux_amd64.tar.gz';
const COMPRESSED_URL = 'https://releases.test/v1/my-server.gz';
const FETCHED_NAME = Value.Parse(FilenameSchema, 'my-server');

/**
 * More of a download than a gunzip reads ahead of what it was asked for, arriving in the pieces a
 * transfer arrives in — so a walk that stops at the entry it wanted stops with the rest of the
 * download still to come, which is the only state in which reading it to the end costs anything.
 */
const A_LONG_DOWNLOAD = 524_288;
const A_TRANSFER_CHUNK = 65_536;

/**
 * A binary the api fetched itself. Every refusal here is about a url somebody typed, so each one
 * has to leave the app exactly as it was — an artifact half made is a deploy that cannot be
 * retried by following the same link again.
 */
const CACHED_URL = 'https://releases.test/v1/my-server.tar.gz';
const CREDENTIALLED_URL = 'https://someone:secret@releases.test/v1/my-server';
const UNWRAPPED_NAME = Value.Parse(FilenameSchema, 'app');
const CACHED_SIZE_BYTES = 128;

/** A release this api has already fetched, stored and watched come up. */
function alreadyDeployed(sourceDigest: Sha256Digest): CachedBinaryRow {
  return {
    source_digest: sourceDigest,
    digest: Value.Parse(Sha256DigestSchema, BINARY_DIGEST),
    size_bytes: String(CACHED_SIZE_BYTES),
    object_key: Value.Parse(ObjectKeySchema, BINARY_DIGEST),
    original_file_name: UNWRAPPED_NAME,
  };
}

/**
 * The whole point of the digest a link carries: the second person to follow it gets the binary
 * without anybody going back to the release host for it.
 */
describe('a release nibrun already holds is not fetched twice', () => {
  const SERVED_DIGEST = Value.Parse(Sha256DigestSchema, BINARY_DIGEST);

  function readyToReuse() {
    const built = build();
    built.cachedRepo.remember(alreadyDeployed(SERVED_DIGEST));
    built.storage.put({
      objectKey: Value.Parse(ObjectKeySchema, BINARY_DIGEST),
      text: BINARY_TEXT,
    });
    return built;
  }

  test('the url is never opened, and the artifact points at the bytes already stored', async () => {
    const { service, sourceRepo, storage } = readyToReuse();

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: CACHED_URL,
      sha256: SERVED_DIGEST,
    });

    expect(sourceRepo.opened).toEqual([]);
    expect(artifact.digest).toBe(SERVED_DIGEST);
    expect(artifact.objectKey).toBe(Value.Parse(ObjectKeySchema, BINARY_DIGEST));
    expect(storage.objects.size).toBe(1);
    expect(isValidMessage({ schema: ArtifactSchema, value: artifact })).toBe(true);
  });

  /**
   * The name the binary has rather than the one the url has. An executable inside an archive is
   * only ever named by the walk that found it, and a hit skips the walk — so the name has to come
   * from the row, or every reuse of a packed release would be exported as `my-server.tar.gz`.
   */
  test('it carries the name the archive gave it, not the one the url did', async () => {
    const { service } = readyToReuse();

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: CACHED_URL,
      sha256: SERVED_DIGEST,
    });

    expect(artifact.originalFileName).toBe(UNWRAPPED_NAME);
  });

  // The row is per app, as it is for an upload: what two owners share is the object, which is
  // what content addressing has always meant here.
  test('the app gets an artifact of its own, addressed by the url it asked for', async () => {
    const { service, artifactsRepo } = readyToReuse();

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: CACHED_URL,
      sha256: SERVED_DIGEST,
    });

    expect(artifactsRepo.rows.get(artifact.id)?.app_id).toBe(APP_ID);
    expect(artifactsRepo.rows.get(artifact.id)?.original_file_url).toBe(CACHED_URL);
  });

  /**
   * The view is a row and the bytes are not. An app purged between the two leaves a key nothing
   * answers, and an artifact pointed at one would fail on the host — where it costs a deployment
   * that never converges rather than the download it was avoiding.
   */
  test('a row whose object has since gone is fetched again rather than handed on', async () => {
    const { service, sourceRepo, cachedRepo } = build();
    cachedRepo.remember(alreadyDeployed(SERVED_DIGEST));
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
      sha256: SERVED_DIGEST,
    });

    expect(sourceRepo.opened).toEqual([BINARY_URL]);
    expect(artifact.digest).toBe(SERVED_DIGEST);
  });

  // The digest is the whole of what makes reuse exact, so a link without one is a link that has
  // said nothing about what the url should be serving.
  test('a url nobody said a digest for is followed every time', async () => {
    const { service, sourceRepo, cachedRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    await service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL });

    expect(cachedRepo.asked).toEqual([]);
    expect(sourceRepo.opened).toEqual([BINARY_URL]);
  });

  /**
   * The url is written down without whatever a caller authenticated by, so a digest taken from
   * one would stand for bytes anybody naming that digest could then ask for. Neither remembered
   * nor answered from: the download belongs to whoever had the password.
   */
  test('a download reached with a password is neither reused nor remembered', async () => {
    const { service, sourceRepo, cachedRepo, artifactsRepo } = build();
    cachedRepo.remember(alreadyDeployed(SERVED_DIGEST));
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: CREDENTIALLED_URL,
      sha256: SERVED_DIGEST,
    });

    expect(cachedRepo.asked).toEqual([]);
    expect(sourceRepo.opened).toEqual([CREDENTIALLED_URL]);
    expect(artifactsRepo.rows.get(artifact.id)?.source_digest).toBeNull();
  });

  /**
   * The slots exist because a fetch passes through this process, and a hit does not — so a
   * release everyone is deploying stops competing for them. Without this, a link going round
   * would answer the ninth person with the one thing they cannot act on.
   */
  test('a hit costs no fetch slot, so a popular link cannot throttle itself', async () => {
    const { service, sourceRepo, cachedRepo, storage } = build();
    cachedRepo.remember(alreadyDeployed(SERVED_DIGEST));
    storage.put({ objectKey: Value.Parse(ObjectKeySchema, BINARY_DIGEST), text: BINARY_TEXT });
    sourceRepo.answers({ outcome: 'unreachable' });
    const letThemGo = sourceRepo.holdsOpen();

    const held = Array.from({ length: MAX_CONCURRENT_FETCHES }, () =>
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    );
    await Bun.sleep(0);

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: CACHED_URL,
      sha256: SERVED_DIGEST,
    });

    expect(artifact.digest).toBe(SERVED_DIGEST);

    letThemGo();
    await Promise.allSettled(held);
  });
});

/**
 * The half of the deploy button nobody writes a checksum into. A release says what its own asset
 * hashes to, which is the only thing that turns such a url into a key exact enough to reuse — and
 * the only thing a download from one was ever going to be checked against.
 */
describe('a release that publishes its own digest is taken at its word', () => {
  const PUBLISHED = Value.Parse(Sha256DigestSchema, BINARY_DIGEST);

  test('a link with no checksum is held to what the release publishes', async () => {
    const { service, sourceRepo, releaseRepo } = build();
    releaseRepo.publishes(PUBLISHED);
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(releaseRepo.asked).toEqual([BINARY_URL]);
    expect(artifact.digest).toBe(PUBLISHED);
  });

  // Which is what makes the next one free: the digest is written down, so the same release asked
  // for again is answered out of what is already stored.
  test('and the digest it published is what the next deploy finds it by', async () => {
    const { service, sourceRepo, artifactsRepo, releaseRepo } = build();
    releaseRepo.publishes(PUBLISHED);
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(artifactsRepo.rows.get(artifact.id)?.source_digest).toBe(PUBLISHED);
  });

  test('a release nibrun already holds is not downloaded to find that out', async () => {
    const { service, sourceRepo, cachedRepo, releaseRepo, storage } = build();
    releaseRepo.publishes(PUBLISHED);
    cachedRepo.remember(alreadyDeployed(PUBLISHED));
    storage.put({ objectKey: Value.Parse(ObjectKeySchema, BINARY_DIGEST), text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(sourceRepo.opened).toEqual([]);
    expect(artifact.digest).toBe(PUBLISHED);
  });

  /**
   * The caller published the release. Going and asking the host what it thinks would be
   * second-guessing the one person who knows, and would cost a round trip to be told the same
   * thing — or, worse, something else.
   */
  test('a checksum in the link is used without asking anybody', async () => {
    const { service, sourceRepo, releaseRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
      sha256: PUBLISHED,
    });

    expect(releaseRepo.asked).toEqual([]);
  });

  /**
   * Sixty an hour is what an unauthenticated caller gets, so being told nothing is the ordinary
   * answer rather than the exceptional one. It has to cost exactly what it cost before any of
   * this existed: the download, unverified, the way a link with no checksum always was.
   */
  test('a release that says nothing leaves the fetch exactly as it was', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifactsRepo.rows.get(artifact.id)?.source_digest).toBeNull();
  });

  /**
   * The quota is sixty an hour for a caller with no token, so this is not the exceptional path —
   * it is where nibrun spends most of its time. The deploy has to go through regardless: being
   * unable to look a digest up is not a reason to refuse a url that was always fetchable.
   */
  test('a quota that has run out still deploys, by fetching the url as before', async () => {
    const { service, sourceRepo, releaseRepo, artifactsRepo } = build();
    releaseRepo.answers({ outcome: 'rate-limited', until: undefined });
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(sourceRepo.opened).toEqual([BINARY_URL]);
    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifactsRepo.rows.get(artifact.id)?.source_digest).toBeNull();
  });

  /**
   * Said as what the release publishes rather than as what was asked for: nobody asked. A caller
   * who wrote no checksum would otherwise be shown two numbers they have never seen, with nothing
   * to say which of them was supposed to be theirs.
   */
  test('a url serving something other than what was released is refused, and says whose digest it was', async () => {
    const { service, sourceRepo, releaseRepo, artifactsRepo, storage } = build();
    releaseRepo.publishes(SEEDED_DIGEST);
    sourceRepo.serves({ text: BINARY_TEXT });

    const refusal = service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    await expect(refusal).rejects.toThrow('The release publishes');
    await expect(refusal).rejects.toThrow(SEEDED_DIGEST);
    await expect(refusal).rejects.toThrow(BINARY_DIGEST);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });
});

describe('a binary is fetched from the url it was given', () => {
  test('the bytes are stored under their digest, named and addressed by the url', async () => {
    const { service, sourceRepo, storage } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifact.originalFileName).toBe(FETCHED_NAME);
    expect(storage.objects.has(Value.Parse(ObjectKeySchema, BINARY_DIGEST))).toBe(true);
    expect(isValidMessage({ schema: ArtifactSchema, value: artifact })).toBe(true);
  });

  /**
   * The one thing about the bytes a caller can know before the fetch, and so the one thing worth
   * taking their word about — as an expectation, checked against what they came to.
   */
  test('a checksum the bytes hash to is the fetch going ahead as it would have', async () => {
    const { service, sourceRepo, storage } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
      sha256: Value.Parse(Sha256DigestSchema, BINARY_DIGEST),
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(storage.objects.has(Value.Parse(ObjectKeySchema, BINARY_DIGEST))).toBe(true);
  });

  // Both digests, because either could be the surprising one: the release the link was written
  // against may have been replaced, or the checksum beside it may never have been this binary's.
  test('and a checksum they hash to nothing like is refused, leaving nothing behind', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    const refusal = service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
      sha256: SEEDED_DIGEST,
    });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    await expect(refusal).rejects.toThrow(SEEDED_DIGEST);
    await expect(refusal).rejects.toThrow(BINARY_DIGEST);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  // Kept where the bytes are described rather than answered with: nothing downstream is told
  // where a binary was found, and a host least of all.
  test('where it came from is written down beside the name it was given', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: BINARY_URL,
    });

    expect(artifactsRepo.rows.get(artifact.id)?.original_file_url).toBe(BINARY_URL);
    expect(Object.keys(artifact)).not.toContain('originalFileUrl');
  });

  test('the staging slot it came through is given up', async () => {
    const { service, sourceRepo, storage } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    await service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL });

    expect([...storage.objects.keys()]).toEqual([Value.Parse(ObjectKeySchema, BINARY_DIGEST)]);
  });

  test('an app the caller does not own is never fetched for', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OTHER_OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(sourceRepo.opened).toEqual([]);
  });

  test('a url nibrun cannot reach is said back with the url in it', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.answers({ outcome: 'unreachable' });

    const refusal = service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    await expect(refusal).rejects.toThrow(BINARY_URL);
    expect(artifactsRepo.rows.size).toBe(0);
  });

  test('a url that answers with a status is that status, not a nibrun failure', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.answers({ outcome: 'refused', status: 404 });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toThrow('404');
    expect(artifactsRepo.rows.size).toBe(0);
  });

  test('a url ending in nothing an export could be named after is refused unread', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });

    await expect(
      service.createFromUrl({
        appId: APP_ID,
        ownerId: OWNER_ID,
        url: 'https://releases.test/downloads/',
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(sourceRepo.opened).toEqual([]);
  });

  test('a source declaring more than may be stored is refused before it is read', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.serves({ text: BINARY_TEXT, declaredSizeBytes: MAX_ARTIFACT_SIZE_BYTES + 1 });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  test('what the url served is refused on its own terms, and leaves nothing behind', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.serves({ text: 'not an executable' });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  // Every other way this url could be unusable is answered as the url's; a socket that dropped
  // part way is no more this api's fault than a 404, and reads as one to whoever has to retry.
  test('a source that stops part way is the link, and leaves nothing behind either', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.stopsPartWay();

    const refusal = service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    await expect(refusal).rejects.toThrow(BINARY_URL);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  // The refusal comes after the fetch is already open, and a body nobody is going to read holds
  // its connection until it is let go of.
  test('a body handed over and then not wanted is let go of', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT, declaredSizeBytes: MAX_ARTIFACT_SIZE_BYTES + 1 });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(sourceRepo.wasLetGo).toBe(true);
  });

  // The bytes reach the row through a cap on how many of them will be read, so what has to be let
  // go of is a stream with something in front of it rather than the source itself.
  test('a source still sending against a row that never began is let go of', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    artifactsRepo.refusesToInsert();
    sourceRepo.keepsSending();

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(sourceRepo.wasLetGo).toBe(true);
  });

  test('a url that resolves inside nibrun is said back as the host it resolved to', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.answers({ outcome: 'private-address', host: 'internal.releases.test' });

    const refusal = service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    await expect(refusal).rejects.toThrow('internal.releases.test');
    expect(artifactsRepo.rows.size).toBe(0);
  });

  test('a redirect out of https is said back as the hop the caller never saw', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.answers({ outcome: 'insecure-redirect', to: 'http://mirror.test/my-server' });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toThrow('http://mirror.test/my-server');
  });

  test('what a caller authenticated with is fetched with and not written down', async () => {
    const { service, sourceRepo, artifactsRepo } = build();
    sourceRepo.serves({ text: BINARY_TEXT });
    const withToken = 'https://owner:ghp_secret@releases.test/v1/my-server';

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: withToken,
    });

    expect(sourceRepo.opened).toEqual([withToken]);
    expect(artifactsRepo.rows.get(artifact.id)?.original_file_url).toBe(
      'https://releases.test/v1/my-server',
    );
  });

  /**
   * A release is published zipped more often than not, and the alternative to reading one here is
   * telling whoever followed the link to download it, unzip it, and upload the one file inside.
   */
  test('a release that ships zipped is the executable inside it', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({
      bytes: archiveOf([
        { name: 'CHANGELOG.md', content: bytesOf('# Changelog\n\nAll of it.\n') },
        { name: 'my-server', content: bytesOf(BINARY_TEXT) },
      ]),
    });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: ARCHIVE_URL,
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(storage.objects.has(Value.Parse(ObjectKeySchema, BINARY_DIGEST))).toBe(true);
    expect(artifactsRepo.rows.get(artifact.id)?.original_file_url).toBe(ARCHIVE_URL);
  });

  /**
   * Held against the download rather than against the executable unwrapped from it: a release
   * publishes a checksum over the file it uploaded, so a `checksums.txt` beside a zip is the
   * zip's — nobody anywhere publishes the digest of one file inside an archive.
   *
   * The walk stops at the entry it wanted, so this is also the one case where checking a checksum
   * means reading the rest of a download nothing else needed.
   */
  test('and a checksum is what the zip hashes to, not the executable inside it', async () => {
    const { service, sourceRepo } = build();
    const bytes = archiveOf([
      { name: 'my-server', content: bytesOf(BINARY_TEXT) },
      { name: 'CHANGELOG.md', content: bytesOf('# Changelog\n') },
    ]);
    sourceRepo.servesBytes({ bytes });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: ARCHIVE_URL,
      sha256: digestOf(bytes),
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
  });

  /**
   * The same, with a gunzip in the middle of it. What the walk lets go of is the decompressed
   * bytes and what a checksum is over is the compressed ones, so the reading-to-the-end that
   * checking one costs has to travel back through the engine to reach the download.
   *
   * The entry is first and the rest of the tarball is longer than a gunzip reads ahead, so the
   * walk really does stop with most of the download still on its way.
   */
  test('and a checksum is what the tarball hashes to, gunzip and all', async () => {
    const { service, sourceRepo } = build();
    const bytes = gzippedTarballOf([
      { name: 'my-server', content: bytesOf(BINARY_TEXT) },
      { name: 'CHANGELOG.md', content: incompressible(A_LONG_DOWNLOAD) },
    ]);
    sourceRepo.servesBytes({ bytes, chunkBytes: A_TRANSFER_CHUNK });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: TARBALL_URL,
      sha256: digestOf(bytes),
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
  });

  // A walk that gives up part way is the other side of the same thing: what it stopped reading is
  // still what the checksum was published over.
  test('and a tarball holding nothing executable is still read to the end of the download', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.servesBytes({
      bytes: gzippedTarballOf([{ name: 'LICENSE.md', content: bytesOf('The MIT Licence.\n') }]),
    });

    const refusal = service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: TARBALL_URL,
      sha256: Value.Parse(Sha256DigestSchema, BINARY_DIGEST),
    });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
  });

  // A bare gzip is handed on rather than walked, so what reaches the store is already decompressed
  // — and the digest is still the one a release would publish, over the file it uploaded.
  test('and a bare gzip is held to what the gzip hashes to, not the binary inside it', async () => {
    const { service, sourceRepo } = build();
    const bytes = gzipSync(bytesOf(BINARY_TEXT));
    sourceRepo.servesBytes({ bytes });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: COMPRESSED_URL,
      sha256: digestOf(bytes),
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifact.originalFileName).toBe(FETCHED_NAME);
  });

  test('and the digest of that executable is not what the zip is held to', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({
      bytes: archiveOf([{ name: 'my-server', content: bytesOf(BINARY_TEXT) }]),
    });

    const refusal = service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: ARCHIVE_URL,
      sha256: Value.Parse(Sha256DigestSchema, BINARY_DIGEST),
    });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  // The name an export writes the binary out as, which the url only ever spells `.zip`.
  test('and is named after the entry rather than the archive that carried it', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.servesBytes({
      bytes: archiveOf([{ name: 'my-server', content: bytesOf(BINARY_TEXT) }]),
    });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: ARCHIVE_URL,
    });

    expect(artifact.originalFileName).toBe(FETCHED_NAME);
  });

  /**
   * Which is how a linux release is published far more often than zipped: the go and rust toolings
   * both write one, and a url ending `.tar.gz` is the ordinary shape of a release download.
   */
  test('a release that ships as a tarball is the executable inside it', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({
      bytes: gzippedTarballOf([
        { name: 'CHANGELOG.md', content: bytesOf('# Changelog\n\nAll of it.\n') },
        { name: 'dist/my-server', content: bytesOf(BINARY_TEXT) },
      ]),
    });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: TARBALL_URL,
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifact.originalFileName).toBe(FETCHED_NAME);
    expect(storage.objects.has(Value.Parse(ObjectKeySchema, BINARY_DIGEST))).toBe(true);
    expect(artifactsRepo.rows.get(artifact.id)?.original_file_url).toBe(TARBALL_URL);
  });

  /**
   * A release published as a bare `my-server.gz` is one gunzip away from being deployable, and
   * what is stored is the executable rather than the download — so the suffix that named the
   * download is not the name a host writes it back out under.
   */
  test('a release that ships as a bare gzip is the executable inside it, unsuffixed', async () => {
    const { service, sourceRepo, storage } = build();
    sourceRepo.servesBytes({ bytes: gzipSync(bytesOf(BINARY_TEXT)) });

    const artifact = await service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: COMPRESSED_URL,
    });

    expect(artifact.digest).toBe(Value.Parse(Sha256DigestSchema, BINARY_DIGEST));
    expect(artifact.originalFileName).toBe(FETCHED_NAME);
    expect(storage.objects.has(Value.Parse(ObjectKeySchema, BINARY_DIGEST))).toBe(true);
  });

  /**
   * A bare gzip is handed on rather than walked, so nothing has looked inside it by the time it is
   * being written — which makes this the one path where a download holding far more than it sent
   * is found while the store is already taking it. It still has to leave nothing behind.
   *
   * Opening with the ELF magic is what makes it worth refusing: without that it is turned away on
   * its first chunk for not being an executable, and never expands into anything.
   */
  test('a download holding far more than it sent is refused and leaves nothing behind', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({ bytes: gzipSync(expandsTooFar({ asExecutable: true })) });

    const refusal = service.createFromUrl({
      appId: APP_ID,
      ownerId: OWNER_ID,
      url: COMPRESSED_URL,
    });

    await expect(refusal).rejects.toBeInstanceOf(BadRequestError);
    // Said as the expansion rather than as bytes that turned out not to be an executable, which
    // is what the same download refused at the far end would have come back as.
    await expect(refusal).rejects.toThrow(String(MAX_EXPANSION));
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  test('a tarball holding nothing executable is refused and leaves nothing behind', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({
      bytes: gzippedTarballOf([{ name: 'LICENSE.md', content: bytesOf('The MIT Licence.\n') }]),
    });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: TARBALL_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  test('a zip holding nothing executable is refused and leaves nothing behind', async () => {
    const { service, sourceRepo, artifactsRepo, storage } = build();
    sourceRepo.servesBytes({
      bytes: archiveOf([{ name: 'LICENSE.md', content: bytesOf('The MIT Licence.\n') }]),
    });

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: ARCHIVE_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(artifactsRepo.rows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  /**
   * A fetched binary passes through this process, which is the cost signing an upload away was
   * meant to avoid paying — so what is bounded is how many of them it carries at once, and a
   * caller told to come back has a request that ended rather than one still being held.
   */
  test('only so many binaries are fetched through this end at once', async () => {
    const { service, sourceRepo } = build();
    sourceRepo.answers({ outcome: 'unreachable' });
    const letThemGo = sourceRepo.holdsOpen();

    const held = Array.from({ length: MAX_CONCURRENT_FETCHES }, () =>
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    );
    await Bun.sleep(0);

    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(TooManyRequestsError);

    letThemGo();
    await Promise.allSettled(held);

    // The slot each was holding is given back, so the next caller is not refused for their sake.
    await expect(
      service.createFromUrl({ appId: APP_ID, ownerId: OWNER_ID, url: BINARY_URL }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

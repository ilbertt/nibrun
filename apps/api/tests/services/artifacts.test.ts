import { describe, expect, test } from 'bun:test';
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
  Sha256DigestSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  AbandonedArtifactRow,
  ArtifactRow,
  ArtifactsRepositoryContract,
  CompleteArtifactInput,
  PendingArtifactRow,
} from '#repositories/artifacts.repository.ts';
import {
  type AppOwnership,
  ArtifactsService,
  MAX_ARTIFACT_SIZE_BYTES,
} from '#services/artifacts.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';

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

type StoredRow = Omit<ArtifactRow, 'digest' | 'size_bytes' | 'object_key'> & {
  digest: ArtifactRow['digest'] | null;
  size_bytes: ArtifactRow['size_bytes'] | null;
  object_key: ArtifactRow['object_key'] | null;
};

/**
 * A row is an artifact once it has a digest and an upload still in flight until then, which is
 * the distinction the SQL draws — so this fake draws it too rather than answering every read the
 * same way and leaving the service to sort them out.
 */
class FakeArtifactsRepository implements ArtifactsRepositoryContract {
  readonly rows = new Map<ArtifactId, StoredRow>();
  private readonly ownedBy: OwnerId;

  constructor(ownedBy: OwnerId) {
    this.ownedBy = ownedBy;
  }

  insertPending({
    appId,
    ownerId,
    originalFileName,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    originalFileName: Filename;
  }): Promise<PendingArtifactRow | null> {
    if (ownerId !== this.ownedBy) {
      return Promise.resolve(null);
    }
    const row: StoredRow = {
      id: Value.Parse(ArtifactIdSchema, `artifact-${this.rows.size}`),
      app_id: appId,
      digest: null,
      size_bytes: null,
      object_key: null,
      original_file_name: originalFileName,
      created_at: SEEDED_CREATED_AT,
    };
    this.rows.set(row.id, row);
    return Promise.resolve({
      id: row.id,
      app_id: row.app_id,
      original_file_name: row.original_file_name,
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

function build(storageRepo: FakeStorage = new FakeStorage()) {
  const artifactsRepo = new FakeArtifactsRepository(OWNER_ID);
  return {
    storage: storageRepo,
    artifactsRepo,
    service: new ArtifactsService({ artifactsRepo, storageRepo, appsRepo }),
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

  test('an artifact nobody is waiting on cannot be completed twice', async () => {
    const { service, storage } = build();
    const artifact = await upload({ service, storage });

    await expect(
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, artifactId: artifact.id }),
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

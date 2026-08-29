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
import {
  type AppOwnership,
  ArtifactsService,
  MAX_ARTIFACT_SIZE_BYTES,
  MAX_CONCURRENT_FETCHES,
} from '#services/artifacts.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';
import { archiveOf } from '#tests/support/archives.ts';
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

  servesBytes({
    bytes,
    declaredSizeBytes,
  }: {
    bytes: Uint8Array;
    declaredSizeBytes?: number;
  }): void {
    this.answers({
      outcome: 'open',
      body: streamOf({
        bytes,
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
  onCancel,
}: {
  bytes: Uint8Array;
  onCancel?: () => void;
}): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.close();
        return;
      }
      sent = true;
      controller.enqueue(bytes);
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

function build(storageRepo: FakeStorage = new FakeStorage()) {
  const artifactsRepo = new FakeArtifactsRepository(OWNER_ID);
  const sourceRepo = new FakeBinarySource();
  return {
    storage: storageRepo,
    artifactsRepo,
    sourceRepo,
    service: new ArtifactsService({ artifactsRepo, storageRepo, sourceRepo, appsRepo }),
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

const BINARY_URL = 'https://releases.test/v1/my-server';
const ARCHIVE_URL = 'https://releases.test/v1/my-server_1.2.3_linux_amd64.zip';
const TARBALL_URL = 'https://releases.test/v1/my-server_1.2.3_linux_amd64.tar.gz';
const FETCHED_NAME = Value.Parse(FilenameSchema, 'my-server');

/**
 * A binary the api fetched itself. Every refusal here is about a url somebody typed, so each one
 * has to leave the app exactly as it was — an artifact half made is a deploy that cannot be
 * retried by following the same link again.
 */
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

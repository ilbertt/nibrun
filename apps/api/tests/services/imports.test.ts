import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  type Filename,
  FilenameSchema,
  type ImportId,
  ImportIdSchema,
  ImportSchema,
  isValidMessage,
  type ObjectKey,
  type OwnerId,
  type Sha256Digest,
  Value,
} from '@repo/protocol';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import type { AppsRepositoryContract } from '#repositories/apps.repository.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  AbandonedImportRow,
  CompleteImportInput,
  ImportRow,
  ImportsRepositoryContract,
  PendingImportRow,
  SpentImportRow,
} from '#repositories/imports.repository.ts';
import { ImportsService, importKey, MAX_IMPORT_SIZE_BYTES } from '#services/imports.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';

const ARCHIVE_TEXT = 'not really a tarball, and deliberately so';
const UPLOADED_NAME = Value.Parse(FilenameSchema, 'pb_data.tar.gz');
const SIGNED_URL = 'https://store.test/signed';

const A_DAY_SECONDS = 86_400;
const MS_PER_SECOND = 1_000;
const AN_HOUR_MS = 3_600_000;
const PAST_THE_SWEEP_MS = A_DAY_SECONDS * MS_PER_SECOND + AN_HOUR_MS;

const NEXT_ID = { value: 0 };

function anImportId(): ImportId {
  NEXT_ID.value += 1;
  return Value.Parse(ImportIdSchema, `import-${NEXT_ID.value}`);
}

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function digestOf(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

type StoredRow = Omit<ImportRow, 'digest' | 'size_bytes'> & {
  digest: ImportRow['digest'] | null;
  size_bytes: ImportRow['size_bytes'] | null;
  object_key: ObjectKey | null;
};

/**
 * A row is an import once it has a digest and an upload still in flight until then, which is the
 * distinction the SQL draws — so this fake draws it too rather than answering every read the same
 * way and leaving the service to sort them out.
 */
class FakeImportsRepository implements ImportsRepositoryContract {
  readonly rows = new Map<ImportId, StoredRow>();
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
  }): Promise<PendingImportRow | null> {
    if (ownerId !== this.ownedBy) {
      return Promise.resolve(null);
    }
    const id = anImportId();
    this.rows.set(id, {
      id,
      app_id: appId,
      digest: null,
      size_bytes: null,
      object_key: null,
      original_file_name: originalFileName,
      created_at: new Date(),
    });
    return Promise.resolve(this.#pending(id));
  }

  complete({
    importId,
    ownerId,
    digest,
    sizeBytes,
    objectKey,
  }: CompleteImportInput): Promise<ImportRow | null> {
    const row = this.rows.get(importId);
    if (!row || ownerId !== this.ownedBy || row.digest !== null) {
      return Promise.resolve(null);
    }
    const completed = {
      ...row,
      digest,
      size_bytes: String(sizeBytes),
      object_key: objectKey,
    } satisfies StoredRow;
    this.rows.set(importId, completed);
    return Promise.resolve(completed as ImportRow);
  }

  remove({ importId, ownerId }: { importId: ImportId; ownerId: OwnerId }): Promise<void> {
    const row = this.rows.get(importId);
    if (row && ownerId === this.ownedBy && row.digest === null) {
      this.rows.delete(importId);
    }
    return Promise.resolve();
  }

  findPending({
    importId,
    ownerId,
  }: {
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<PendingImportRow | null> {
    const row = this.rows.get(importId);
    return Promise.resolve(
      row && ownerId === this.ownedBy && row.digest === null ? this.#pending(row.id) : null,
    );
  }

  findById({
    importId,
    ownerId,
  }: {
    importId: ImportId;
    ownerId: OwnerId;
  }): Promise<ImportRow | null> {
    const row = this.rows.get(importId);
    return Promise.resolve(
      row && ownerId === this.ownedBy && row.digest !== null ? (row as ImportRow) : null,
    );
  }

  listAbandoned({ olderThanSeconds }: { olderThanSeconds: number }): Promise<AbandonedImportRow[]> {
    const cutoff = Date.now() - olderThanSeconds * MS_PER_SECOND;
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.digest === null && row.created_at.getTime() < cutoff)
        .map((row) => ({ id: row.id, app_id: row.app_id })),
    );
  }

  removeAbandoned({ importId }: { importId: ImportId }): Promise<void> {
    const row = this.rows.get(importId);
    if (row && row.digest === null) {
      this.rows.delete(importId);
    }
    return Promise.resolve();
  }

  listSpent({ limit }: { limit: number }): Promise<SpentImportRow[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.object_key !== null && this.spentApps.includes(row.app_id))
        .slice(0, limit)
        .map((row) => ({ id: row.id, object_key: row.object_key as ObjectKey })),
    );
  }

  forgetObject({ importId }: { importId: ImportId }): Promise<void> {
    const row = this.rows.get(importId);
    if (row && row.object_key !== null) {
      this.rows.set(importId, { ...row, object_key: null });
    }
    return Promise.resolve();
  }

  /** The apps a host has said hold a filesystem, which is what makes their archives unusable. */
  readonly spentApps: AppId[] = [];

  /** Pretends the row has been sitting there since before the sweep's cutoff. */
  age(importId: ImportId): void {
    const row = this.rows.get(importId);
    if (row) {
      this.rows.set(importId, { ...row, created_at: new Date(Date.now() - PAST_THE_SWEEP_MS) });
    }
  }

  #pending(id: ImportId): PendingImportRow | null {
    const row = this.rows.get(id);
    return row
      ? {
          id: row.id,
          app_id: row.app_id,
          original_file_name: row.original_file_name,
          created_at: row.created_at,
        }
      : null;
  }
}

class FakeStorage implements ArtifactStorageRepositoryContract {
  readonly objects = new Map<ObjectKey, Uint8Array>();
  readonly signed: { objectKey: ObjectKey; sizeBytes: number }[] = [];
  readonly removed: ObjectKey[] = [];
  readonly refused = new Set<ObjectKey>();

  /** A bucket turning one delete down, which must leave the row that names it alone. */
  refuse(objectKey: ObjectKey): void {
    this.refused.add(objectKey);
  }

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

  copy(): Promise<void> {
    return Promise.reject(new Error('an import is never copied anywhere'));
  }

  exists({ objectKey }: { objectKey: ObjectKey }): Promise<boolean> {
    return Promise.resolve(this.objects.has(objectKey));
  }

  remove({ objectKey }: { objectKey: ObjectKey }): Promise<void> {
    if (this.refused.has(objectKey)) {
      return Promise.reject(new Error('the bucket refused the delete'));
    }
    this.removed.push(objectKey);
    this.objects.delete(objectKey);
    return Promise.resolve();
  }

  /** Stands in for the caller spending the signed url. */
  put({ objectKey, bytes }: { objectKey: ObjectKey; bytes: Uint8Array }): void {
    this.objects.set(objectKey, bytes);
  }
}

class FakeAppsRepository {
  isOwnedBy({ ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<boolean> {
    return Promise.resolve(ownerId === OWNER_ID);
  }
}

function build() {
  const importsRepo = new FakeImportsRepository(OWNER_ID);
  const storage = new FakeStorage();
  return {
    importsRepo,
    storage,
    service: new ImportsService({
      importsRepo,
      storageRepo: storage,
      appsRepo: new FakeAppsRepository() as unknown as AppsRepositoryContract,
    }),
  };
}

/** The whole round trip an owner makes: ask, PUT, say it landed. */
async function uploaded({
  service,
  storage,
  bytes = bytesOf(ARCHIVE_TEXT),
}: {
  service: ImportsService;
  storage: FakeStorage;
  bytes?: Uint8Array;
}) {
  const begun = await service.create({
    appId: APP_ID,
    ownerId: OWNER_ID,
    filename: UPLOADED_NAME,
    sizeBytes: bytes.byteLength,
  });
  storage.put({ objectKey: importKey({ appId: APP_ID, importId: begun.importId }), bytes });
  return {
    begun,
    stored: await service.completeUpload({
      appId: APP_ID,
      ownerId: OWNER_ID,
      importId: begun.importId,
    }),
  };
}

describe('an upload is addressed by the row it makes', () => {
  test('the caller is handed a url signed for exactly the size they declared', async () => {
    const { service, storage } = build();

    const begun = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: ARCHIVE_TEXT.length,
    });

    expect(storage.signed).toEqual([
      {
        objectKey: importKey({ appId: APP_ID, importId: begun.importId }),
        sizeBytes: ARCHIVE_TEXT.length,
      },
    ]);
    expect(begun.url).toContain(SIGNED_URL);
  });

  /**
   * The key is the row's, not the bytes'. Two owners uploading identical archives must not share
   * an object: expiring one would take the other's away, and neither of them agreed to that.
   */
  test('two identical archives are two objects', async () => {
    const { service, storage } = build();

    const first = await uploaded({ service, storage });
    const second = await uploaded({ service, storage });

    expect(first.stored.digest).toBe(second.stored.digest);
    expect(storage.signed.map(({ objectKey }) => objectKey)).toEqual([
      importKey({ appId: APP_ID, importId: first.begun.importId }),
      importKey({ appId: APP_ID, importId: second.begun.importId }),
    ]);
    expect(storage.objects.size).toBe(2);
  });

  test('an app the caller does not own is one that does not exist', async () => {
    const { service } = build();

    await expect(
      service.create({
        appId: APP_ID,
        ownerId: OTHER_OWNER_ID,
        filename: UPLOADED_NAME,
        sizeBytes: ARCHIVE_TEXT.length,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a declared size past the cap is refused before anything is signed', async () => {
    const { service, storage } = build();

    await expect(
      service.create({
        appId: APP_ID,
        ownerId: OWNER_ID,
        filename: UPLOADED_NAME,
        sizeBytes: MAX_IMPORT_SIZE_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(storage.signed).toEqual([]);
  });
});

describe('the bytes are read back rather than taken on trust', () => {
  test('the digest and the size come off what was stored', async () => {
    const { service, storage } = build();
    const bytes = bytesOf(ARCHIVE_TEXT);

    const { stored } = await uploaded({ service, storage, bytes });

    expect(isValidMessage({ schema: ImportSchema, value: stored })).toBe(true);
    expect(stored.digest).toBe(digestOf(bytes) as Sha256Digest);
    expect(stored.sizeBytes).toBe(bytes.byteLength);
    expect(stored.originalFileName).toBe(UPLOADED_NAME);
  });

  /**
   * Nothing here asks what is inside. An artifact is refused unless it is a Linux executable
   * because a host has to run it; here the archive is the payload, and a corrupt one is a volume
   * the host reports failed rather than an upload this end second-guessed.
   */
  test('bytes that are not an archive at all are still stored', async () => {
    const { service, storage } = build();

    const { stored } = await uploaded({ service, storage, bytes: bytesOf('#!/bin/sh\necho hi\n') });

    expect(stored.sizeBytes).toBeGreaterThan(0);
  });

  test('saying an upload landed when it did not is refused', async () => {
    const { service } = build();
    const begun = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: ARCHIVE_TEXT.length,
    });

    await expect(
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, importId: begun.importId }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  /**
   * The store is not this api, and a bucket that let something through is not an argument for
   * keeping it: the signature holds the upload to a length, and this is what happens if it did not.
   */
  test('an object longer than the cap is removed rather than recorded', async () => {
    const { service, storage } = build();
    const begun = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: ARCHIVE_TEXT.length,
    });
    const objectKey = importKey({ appId: APP_ID, importId: begun.importId });
    storage.put({ objectKey, bytes: new Uint8Array(MAX_IMPORT_SIZE_BYTES + 1) });

    await expect(
      service.completeUpload({ appId: APP_ID, ownerId: OWNER_ID, importId: begun.importId }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(storage.objects.has(objectKey)).toBe(false);
  });

  test('a second report of the same upload is the import it already made', async () => {
    const { service, storage } = build();
    const { begun, stored } = await uploaded({ service, storage });

    const again = await service.completeUpload({
      appId: APP_ID,
      ownerId: OWNER_ID,
      importId: begun.importId,
    });

    expect(again).toEqual(stored);
  });

  test('an import nobody uploaded is not found', async () => {
    const { service } = build();

    await expect(
      service.get({ appId: APP_ID, ownerId: OWNER_ID, importId: anImportId() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('a refusal names the cap rather than the number that broke it', async () => {
    const { service } = build();

    const refusal = await service
      .create({
        appId: APP_ID,
        ownerId: OWNER_ID,
        filename: UPLOADED_NAME,
        sizeBytes: MAX_IMPORT_SIZE_BYTES + 1,
      })
      .catch((error: Error) => error.message);

    expect(refusal).toBe('An import may be at most 1 GiB.');
  });
});

describe('an upload that never lands leaves nothing behind', () => {
  test('a caller saying it failed takes the row and the object with it', async () => {
    const { service, storage, importsRepo } = build();
    const begun = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: ARCHIVE_TEXT.length,
    });
    const objectKey = importKey({ appId: APP_ID, importId: begun.importId });
    storage.put({ objectKey, bytes: bytesOf(ARCHIVE_TEXT) });

    await service.failUpload({ appId: APP_ID, ownerId: OWNER_ID, importId: begun.importId });

    expect(storage.objects.has(objectKey)).toBe(false);
    expect(importsRepo.rows.size).toBe(0);
  });

  test('one nobody ever came back about is swept, object first', async () => {
    const { service, storage, importsRepo } = build();
    const begun = await service.create({
      appId: APP_ID,
      ownerId: OWNER_ID,
      filename: UPLOADED_NAME,
      sizeBytes: ARCHIVE_TEXT.length,
    });
    const objectKey = importKey({ appId: APP_ID, importId: begun.importId });
    storage.put({ objectKey, bytes: bytesOf(ARCHIVE_TEXT) });
    importsRepo.age(begun.importId);

    await service.sweepAbandoned();

    expect(storage.removed).toEqual([objectKey]);
    expect(importsRepo.rows.size).toBe(0);
  });

  test('a completed import is not swept out from under the app that names it', async () => {
    const { service, storage, importsRepo } = build();
    const { begun } = await uploaded({ service, storage });
    importsRepo.age(begun.importId);

    await service.sweepAbandoned();

    expect(importsRepo.rows.size).toBe(1);
  });
});

/**
 * The bucket's own expiry is the backstop for an upload nobody deployed. This is for the archives
 * that can no longer do anything: eventually is far too long to leave an owner's whole dataset
 * lying in a bucket beside the filesystem it became.
 */
describe('an archive that can no longer create a filesystem stops being stored', () => {
  test("an app whose data exists has its archive's bytes removed", async () => {
    const { service, storage, importsRepo } = build();
    const { begun } = await uploaded({ service, storage });
    importsRepo.spentApps.push(APP_ID);

    await service.sweepSpent();

    expect(storage.removed).toEqual([importKey({ appId: APP_ID, importId: begun.importId })]);
    expect(storage.objects.size).toBe(0);
  });

  // What the owner uploaded and what it hashed to is the app's history; only where the bytes were
  // has stopped being true.
  test('the row and its digest stay behind', async () => {
    const { service, storage, importsRepo } = build();
    const { begun, stored } = await uploaded({ service, storage });
    importsRepo.spentApps.push(APP_ID);

    await service.sweepSpent();

    expect(importsRepo.rows.get(begun.importId)).toMatchObject({
      digest: stored.digest,
      object_key: null,
    });
  });

  // Membership is having an object left, which is the same sentence as the work being done — so a
  // second pass finds nothing rather than deleting twice.
  test('a pass that has already run does nothing on the next report', async () => {
    const { service, storage, importsRepo } = build();
    await uploaded({ service, storage });
    importsRepo.spentApps.push(APP_ID);

    await service.sweepSpent();
    await service.sweepSpent();

    expect(storage.removed).toHaveLength(1);
  });

  test('an app whose filesystem does not exist yet keeps its archive', async () => {
    const { service, storage } = build();
    await uploaded({ service, storage });

    await service.sweepSpent();

    expect(storage.removed).toEqual([]);
    expect(storage.objects.size).toBe(1);
  });

  /**
   * Not only the ones that were used. An archive nobody ever deployed against an app whose data is
   * now there is one `resetDataFrom` would refuse, so what it is holding is storage nothing can
   * ever spend.
   */
  test('one nobody ever deployed is removed too, once the data exists', async () => {
    const { service, storage, importsRepo } = build();
    await uploaded({ service, storage });
    importsRepo.spentApps.push(APP_ID);

    await service.sweepSpent();

    expect(storage.objects.size).toBe(0);
  });

  // A bucket refusing one delete leaves the row still naming it, so the next report finds it again.
  test('an object that could not be removed is left to be found again', async () => {
    const { service, storage, importsRepo } = build();
    const { begun } = await uploaded({ service, storage });
    importsRepo.spentApps.push(APP_ID);
    storage.refuse(importKey({ appId: APP_ID, importId: begun.importId }));

    await service.sweepSpent();

    expect(importsRepo.rows.get(begun.importId)?.object_key).not.toBeNull();
  });
});

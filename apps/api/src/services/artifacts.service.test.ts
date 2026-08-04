import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  type ArtifactId,
  ArtifactSchema,
  type Filename,
  isValidMessage,
  type ObjectKey,
  type OwnerId,
  type Sha256Digest,
  type Timestamp,
} from '@repo/protocol';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import type { ArtifactStorageRepositoryContract } from '#repositories/artifact-storage.repository.ts';
import type {
  ArtifactRow,
  ArtifactsRepositoryContract,
  InsertArtifactInput,
} from '#repositories/artifacts.repository.ts';
import { type AppOwnership, ArtifactsService } from '#services/artifacts.service.ts';

const OWNER = 'owner-1' as OwnerId;
const OTHER_OWNER = 'owner-2' as OwnerId;
const APP = 'app-1' as AppId;

// The api refuses anything that is not a Linux executable, so the fixture opens with the ELF
// magic the way a real upload does.
const BINARY_TEXT = '\x7fELFnibrun-test-binary';
const UPLOADED_NAME = 'pocketbase';
const BINARY_DIGEST = 'd9403d88cdf0684fbb9d8e97cf3508e9fb4506cf309a34e42653a1c2bc04a298';

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function binary(name = UPLOADED_NAME): File {
  return new File([bytesOf(BINARY_TEXT)], name);
}

const SEEDED_DIGEST = 'a'.repeat(BINARY_DIGEST.length) as Sha256Digest;
const SEEDED_SIZE_BYTES = 4096;
const SEEDED_CREATED_AT = new Date('2026-01-02T03:04:05.000Z');

/**
 * The ownership predicate lives in the SQL, so this fake answers nothing for an owner it was
 * not built for — a fake that resolved rows and left the caller to compare owners afterwards
 * would be testing a repository this service never talks to.
 */
class FakeArtifactsRepository implements ArtifactsRepositoryContract {
  readonly inserted: InsertArtifactInput[] = [];
  private readonly rows = new Map<ArtifactId, ArtifactRow>();
  private readonly ownedBy: OwnerId;

  constructor(ownedBy: OwnerId) {
    this.ownedBy = ownedBy;
  }

  insert(input: InsertArtifactInput): Promise<ArtifactRow | null> {
    this.inserted.push(input);
    if (input.ownerId !== this.ownedBy) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      this.remember({
        app_id: input.appId,
        digest: input.digest,
        size_bytes: String(input.sizeBytes),
        object_key: input.objectKey,
        original_file_name: input.originalFileName,
      }),
    );
  }

  listByApp({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<ArtifactRow[]> {
    if (ownerId !== this.ownedBy) {
      return Promise.resolve([]);
    }
    return Promise.resolve([...this.rows.values()].filter((row) => row.app_id === appId));
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
    if (ownerId !== this.ownedBy || row?.app_id !== appId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(row);
  }

  seed(): ArtifactRow {
    return this.remember({
      app_id: APP,
      digest: SEEDED_DIGEST,
      size_bytes: String(SEEDED_SIZE_BYTES),
      object_key: SEEDED_DIGEST as string as ObjectKey,
      original_file_name: UPLOADED_NAME as Filename,
    });
  }

  private remember(row: Omit<ArtifactRow, 'id' | 'created_at'>): ArtifactRow {
    const stored: ArtifactRow = {
      ...row,
      id: `artifact-${this.rows.size}` as ArtifactId,
      created_at: SEEDED_CREATED_AT,
    };
    this.rows.set(stored.id, stored);
    return stored;
  }
}

class FakeStorage implements ArtifactStorageRepositoryContract {
  readonly written: { objectKey: ObjectKey; bytes: Uint8Array }[] = [];
  #alreadyStored: boolean;

  constructor({ alreadyStored = false }: { alreadyStored?: boolean } = {}) {
    this.#alreadyStored = alreadyStored;
  }

  put(input: { objectKey: ObjectKey; bytes: Uint8Array }): Promise<void> {
    this.written.push(input);
    return Promise.resolve();
  }

  exists(): Promise<boolean> {
    return Promise.resolve(this.#alreadyStored);
  }
}

const BUCKET_REFUSED = 'the bucket said no';

class RefusingStorage implements ArtifactStorageRepositoryContract {
  put(): Promise<void> {
    return Promise.reject(new Error(BUCKET_REFUSED));
  }

  exists(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

const appsRepo: AppOwnership = {
  isOwnedBy: ({ ownerId }) => Promise.resolve(ownerId === OWNER),
};

function build(storageRepo: ArtifactStorageRepositoryContract = new FakeStorage()) {
  const artifactsRepo = new FakeArtifactsRepository(OWNER);
  return {
    artifactsRepo,
    service: new ArtifactsService({ artifactsRepo, storageRepo, appsRepo }),
  };
}

describe('the api records the digest of what it stored', () => {
  test('the digest is taken from the bytes, and those same bytes are what land', async () => {
    const storage = new FakeStorage();
    const { artifactsRepo, service } = build(storage);

    const artifact = await service.create({ appId: APP, ownerId: OWNER, binary: binary() });

    const [written] = storage.written;
    expect(artifact.digest).toBe(BINARY_DIGEST as Sha256Digest);
    expect(artifactsRepo.inserted[0]?.digest).toBe(artifact.digest);
    expect(written?.objectKey).toBe(artifact.objectKey);
    expect(written?.bytes).toEqual(bytesOf(BINARY_TEXT));
    expect(artifact.sizeBytes).toBe(BINARY_TEXT.length);
  });

  test('the key is derived, so two uploads of one binary share the bytes but not the row', async () => {
    const { service } = build();

    const first = await service.create({ appId: APP, ownerId: OWNER, binary: binary() });
    const second = await service.create({ appId: APP, ownerId: OWNER, binary: binary() });

    expect(second.objectKey).toBe(first.objectKey);
    expect(second.id).not.toBe(first.id);
  });

  // The declared content type is whatever the uploader typed. Reaching a host with something
  // the guest cannot exec turns a rejectable upload into a deploy that never converges.
  test('an upload that is not a Linux executable is refused before anything is written', async () => {
    const storage = new FakeStorage();
    const { artifactsRepo, service } = build(storage);

    await expect(
      service.create({
        appId: APP,
        ownerId: OWNER,
        binary: new File(['#!/bin/true'], UPLOADED_NAME),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(artifactsRepo.inserted).toHaveLength(0);
    expect(storage.written).toHaveLength(0);
  });

  // A host writes this name into an export archive, so a name carrying a path is refused at
  // the upload rather than sanitised into a different one.
  test('an upload whose name is a path is refused before anything is written', async () => {
    const storage = new FakeStorage();
    const { artifactsRepo, service } = build(storage);

    await expect(
      service.create({ appId: APP, ownerId: OWNER, binary: binary('../../etc/passwd') }),
    ).rejects.toBeInstanceOf(BadRequestError);

    expect(artifactsRepo.inserted).toHaveLength(0);
    expect(storage.written).toHaveLength(0);
  });

  // Writing them again would send bytes the store already holds under exactly this key.
  test('bytes already under the key are not uploaded a second time', async () => {
    const storage = new FakeStorage({ alreadyStored: true });
    const { service } = build(storage);

    await service.create({ appId: APP, ownerId: OWNER, binary: binary() });

    expect(storage.written).toHaveLength(0);
  });

  // The row is what says the bytes are there, so it must not exist when they are not.
  test('one that never reached the bucket leaves no row behind', async () => {
    const { artifactsRepo, service } = build(new RefusingStorage());

    await expect(service.create({ appId: APP, ownerId: OWNER, binary: binary() })).rejects.toThrow(
      BUCKET_REFUSED,
    );

    expect(artifactsRepo.inserted).toHaveLength(0);
  });
});

describe('an artifact is reachable only through an app its owner owns', () => {
  test('uploading into an app the caller does not own writes no bytes', async () => {
    const storage = new FakeStorage();
    const { service } = build(storage);

    await expect(
      service.create({ appId: APP, ownerId: OTHER_OWNER, binary: binary() }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(storage.written).toEqual([]);
  });

  test("another owner's artifact is missing rather than forbidden", async () => {
    const { artifactsRepo, service } = build();
    const seeded = artifactsRepo.seed();

    await expect(
      service.get({ appId: APP, artifactId: seeded.id, ownerId: OTHER_OWNER }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listing another owner's app yields nothing rather than its artifacts", async () => {
    const { artifactsRepo, service } = build();
    artifactsRepo.seed();

    expect(await service.list({ appId: APP, ownerId: OTHER_OWNER })).toEqual([]);
    expect(await service.list({ appId: APP, ownerId: OWNER })).toHaveLength(1);
  });
});

describe('a row becomes the wire shape the dashboard and the agent both read', () => {
  test('a bigint size becomes a number and a Date becomes an ISO instant', async () => {
    const { artifactsRepo, service } = build();
    const seeded = artifactsRepo.seed();

    const artifact = await service.get({ appId: APP, artifactId: seeded.id, ownerId: OWNER });

    expect(artifact.sizeBytes).toBe(SEEDED_SIZE_BYTES);
    expect(artifact.createdAt).toBe(SEEDED_CREATED_AT.toISOString() as Timestamp);
    expect(isValidMessage({ schema: ArtifactSchema, value: artifact })).toBe(true);
  });
});

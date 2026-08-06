import { describe, expect, test } from 'bun:test';
import type {
  ExportId,
  ExportState,
  HostReportedState,
  ObjectKey,
  OwnerId,
  Timestamp,
} from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type { ExportStorageRepositoryContract } from '#repositories/export-storage.repository.ts';
import type {
  ExportRow,
  ExportsRepositoryContract,
  ReportedExportRow,
  RequestExportInput,
} from '#repositories/exports.repository.ts';
import type { AppOwnership } from '#services/artifacts.service.ts';
import { ExportsService } from '#services/exports.service.ts';
import { APP_ID, OTHER_OWNER_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';

const EXPORT_ID = 'export-1' as ExportId;
const OBJECT_KEY = `exports/${APP_ID}/${EXPORT_ID}.tar.gz` as ObjectKey;
const SIGNED_URL = 'https://exports.test/signed';
const RETENTION_DAYS = 1;
const MS_PER_DAY = 86_400_000;
const BUNDLE_SIZE_BYTES = 2048;

function exportRow(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: EXPORT_ID,
    app_id: APP_ID,
    state: 'pending',
    object_key: OBJECT_KEY,
    size_bytes: null,
    message: null,
    ready_at: null,
    expires_at: new Date(Date.now() + MS_PER_DAY),
    created_at: new Date('2026-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

/**
 * The in-flight rule lives in a unique index, so this fake enforces it the way the index does —
 * a fake that inserted freely would be testing a repository this service never talks to.
 */
class FakeExportsRepository implements ExportsRepositoryContract {
  readonly requested: RequestExportInput[] = [];
  readonly reported: ReportedExportRow[][] = [];
  rows: ExportRow[] = [];
  deployed = true;

  constructor(private readonly ownedBy: OwnerId = OWNER_ID) {}

  request(input: RequestExportInput): Promise<ExportRow | null> {
    this.requested.push(input);
    if (input.ownerId !== this.ownedBy || !this.deployed) {
      return Promise.resolve(null);
    }
    const inFlight = this.rows.find((row) => row.state === 'pending' || row.state === 'preparing');
    if (inFlight) {
      return Promise.resolve(inFlight);
    }
    const row = exportRow({
      id: `export-${this.rows.length + 1}` as ExportId,
      expires_at: input.expiresAt,
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  listByApp(): Promise<ExportRow[]> {
    return Promise.resolve(this.rows);
  }

  findById({
    exportId,
    ownerId,
  }: {
    exportId: ExportId;
    ownerId: OwnerId;
  }): Promise<ExportRow | null> {
    if (ownerId !== this.ownedBy) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.rows.find((row) => row.id === exportId) ?? null);
  }

  applyReport({ reported }: { reported: ReportedExportRow[] }): Promise<void> {
    this.reported.push(reported);
    return Promise.resolve();
  }
}

class FakeExportStorage implements ExportStorageRepositoryContract {
  readonly signed: ObjectKey[] = [];

  signDownload({ objectKey }: { objectKey: ObjectKey }): string {
    this.signed.push(objectKey);
    return SIGNED_URL;
  }
}

function build(exportsRepo = new FakeExportsRepository()) {
  const storage = new FakeExportStorage();
  const appsRepo: AppOwnership = {
    isOwnedBy: ({ ownerId }) => Promise.resolve(ownerId === OWNER_ID),
  };
  return {
    exportsRepo,
    storage,
    service: new ExportsService({
      exportsRepo,
      storageRepo: storage,
      appsRepo,
      retentionDays: RETENTION_DAYS,
    }),
  };
}

describe('asking for a copy of an app', () => {
  test('is answered with a bundle nobody can download yet', async () => {
    const { service } = build();

    const requested = await service.request({ appId: APP_ID, ownerId: OWNER_ID });

    expect(requested.state).toBe('pending');
    expect(requested.downloadUrl).toBeUndefined();
  });

  // Reading a tenant's whole filesystem is the most expensive thing a host does on their behalf.
  test('twice while one is still running returns the one already running', async () => {
    const { service, exportsRepo } = build();

    const first = await service.request({ appId: APP_ID, ownerId: OWNER_ID });
    const second = await service.request({ appId: APP_ID, ownerId: OWNER_ID });

    expect(second.id).toBe(first.id);
    expect(exportsRepo.rows).toHaveLength(1);
  });

  test('carries a deadline the api is willing to promise', async () => {
    const { service, exportsRepo } = build();

    await service.request({ appId: APP_ID, ownerId: OWNER_ID });

    const [requested] = exportsRepo.requested;
    expect(requested?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(requested?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + MS_PER_DAY);
  });

  // A 403 would confirm the app to a stranger.
  test('by someone who does not own it is refused as if it were not there', async () => {
    const { service } = build();

    await expect(
      service.request({ appId: APP_ID, ownerId: OTHER_OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  // The bundle carries the binary, so an app that never ran one has nothing to put in it.
  test('that has never been deployed says so rather than pretending it is missing', async () => {
    const repo = new FakeExportsRepository();
    repo.deployed = false;
    const { service } = build(repo);

    await expect(service.request({ appId: APP_ID, ownerId: OWNER_ID })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('polling an export', () => {
  test('hands over a signed URL once the host has written it', async () => {
    const repo = new FakeExportsRepository();
    repo.rows = [
      exportRow({ state: 'ready', size_bytes: String(BUNDLE_SIZE_BYTES), ready_at: new Date() }),
    ];
    const { service, storage } = build(repo);

    const found = await service.get({ appId: APP_ID, exportId: EXPORT_ID, ownerId: OWNER_ID });

    expect(found.state).toBe('ready');
    expect(found.downloadUrl).toBe(SIGNED_URL);
    expect(found.sizeBytes).toBe(BUNDLE_SIZE_BYTES);
    expect(storage.signed).toEqual([OBJECT_KEY]);
  });

  // The bucket's lifecycle rule is what removed the object; signing for it would hand over a URL
  // that 404s, and claiming `ready` would say the bundle is still there.
  test('past its deadline reads as expired and is not signed for', async () => {
    const repo = new FakeExportsRepository();
    repo.rows = [exportRow({ state: 'ready', expires_at: new Date(Date.now() - MS_PER_DAY) })];
    const { service, storage } = build(repo);

    const found = await service.get({ appId: APP_ID, exportId: EXPORT_ID, ownerId: OWNER_ID });

    expect(found.state).toBe('expired');
    expect(found.downloadUrl).toBeUndefined();
    expect(storage.signed).toEqual([]);
  });

  test('the host could not write is neither signed for nor reported ready', async () => {
    const repo = new FakeExportsRepository();
    repo.rows = [exportRow({ state: 'failed', message: 'no device attached for this app' })];
    const { service, storage } = build(repo);

    const found = await service.get({ appId: APP_ID, exportId: EXPORT_ID, ownerId: OWNER_ID });

    expect(found.state).toBe('failed');
    expect(found.downloadUrl).toBeUndefined();
    expect(storage.signed).toEqual([]);
  });

  test('belonging to another owner is not an export this caller can name', async () => {
    const repo = new FakeExportsRepository();
    repo.rows = [exportRow()];
    const { service } = build(repo);

    await expect(
      service.get({ appId: APP_ID, exportId: EXPORT_ID, ownerId: OTHER_OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('what a host says about the bundles it was told to write', () => {
  test('moves the export it names', async () => {
    const { service, exportsRepo } = build();
    const readyAt = '2026-01-02T03:04:05.000Z' as Timestamp;

    await service.applyHostReport({
      reported: {
        exports: [
          {
            exportId: EXPORT_ID,
            state: 'ready' as ExportState,
            sizeBytes: BUNDLE_SIZE_BYTES,
            readyAt,
          },
        ],
      } as unknown as HostReportedState,
    });

    expect(exportsRepo.reported).toEqual([
      [
        {
          exportId: EXPORT_ID,
          state: 'ready',
          sizeBytes: BUNDLE_SIZE_BYTES,
          readyAt: new Date(readyAt),
          message: null,
        },
      ],
    ]);
  });

  // Every host reports on every poll, and most of them have written nothing.
  test('costs no statement when it says nothing about any', async () => {
    const { service, exportsRepo } = build();

    await service.applyHostReport({ reported: { exports: [] } as unknown as HostReportedState });

    expect(exportsRepo.reported).toEqual([]);
  });
});

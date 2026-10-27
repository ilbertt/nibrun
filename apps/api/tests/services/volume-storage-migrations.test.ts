import { expect, test } from 'bun:test';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  UnstartedVolumeStorageMigrationRow,
  VolumeStorageMigrationRow,
  VolumeStorageMigrationsRepositoryContract,
} from '#repositories/volume-storage-migrations.repository.ts';
import {
  type VolumeStorageMigrationStatusRepositoryContract,
  VolumeStorageMigrationsService,
} from '#services/volume-storage-migrations.service.ts';
import { APP_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';

const EXPECTED_TIMEOUT_MS = 900_000;
const EXPECTED_BATCH_SIZE = 8;

type AbortUnstartedInput = Parameters<
  VolumeStorageMigrationsRepositoryContract['abortUnstarted']
>[0];

class RecoveryRepository implements VolumeStorageMigrationStatusRepositoryContract {
  readonly attempts: AbortUnstartedInput[] = [];
  readonly requests: Parameters<VolumeStorageMigrationsRepositoryContract['listUnstarted']>[0][] =
    [];
  rows: UnstartedVolumeStorageMigrationRow[] = [];
  failConfigId: string | undefined;
  migration: VolumeStorageMigrationRow | null = null;
  owned = true;
  cancelled = true;
  readonly cancellations: Parameters<VolumeStorageMigrationsRepositoryContract['abort']>[0][] = [];
  readonly reads: Parameters<VolumeStorageMigrationsRepositoryContract['findByApp']>[0][] = [];

  findByApp(input: Parameters<VolumeStorageMigrationsRepositoryContract['findByApp']>[0]) {
    this.reads.push(input);
    return Promise.resolve(this.migration);
  }

  abort(input: Parameters<VolumeStorageMigrationsRepositoryContract['abort']>[0]) {
    this.cancellations.push(input);
    return Promise.resolve(this.cancelled);
  }

  listUnstarted(input: Parameters<VolumeStorageMigrationsRepositoryContract['listUnstarted']>[0]) {
    this.requests.push(input);
    return Promise.resolve(this.rows);
  }

  abortUnstarted(input: AbortUnstartedInput): Promise<boolean> {
    this.attempts.push(input);
    if (input.configId === this.failConfigId) {
      return Promise.reject(new Error('database unavailable'));
    }
    return Promise.resolve(true);
  }
}

function service(repo: RecoveryRepository) {
  return new VolumeStorageMigrationsService({
    migrationsRepo: repo,
    appsRepo: {
      isOwnedBy() {
        return Promise.resolve(repo.owned);
      },
    },
  });
}

function migrationRow(
  overrides: Partial<VolumeStorageMigrationRow> = {},
): VolumeStorageMigrationRow {
  return {
    app_id: APP_ID,
    state: 'pending',
    message: null,
    config_id: 'destination',
    created_at: new Date(),
    updated_at: new Date(),
    volume_storage_migration_started_at: null,
    volume_storage_migration_host_id: null,
    volume_storage_endpoint: 'https://objects.example.test',
    volume_storage_bucket: 'customer-bucket',
    volume_storage_prefix: null,
    volume_storage_region: null,
    volume_storage_auth_kind: 'anonymous',
    ...overrides,
  };
}

test('recovery uses the immutable request age and bounds work per host report', async () => {
  const repo = new RecoveryRepository();
  repo.rows = [{ app_id: APP_ID, owner_id: OWNER_ID, config_id: 'destination' }];
  const before = Date.now();
  await service(repo).sweepAbandoned();
  const after = Date.now();
  const cutoff = repo.requests[0]!.createdBefore.getTime();
  expect(cutoff).toBeGreaterThanOrEqual(before - EXPECTED_TIMEOUT_MS);
  expect(cutoff).toBeLessThanOrEqual(after - EXPECTED_TIMEOUT_MS);
  expect(repo.requests[0]!.limit).toBe(EXPECTED_BATCH_SIZE);
  expect(repo.attempts).toEqual([
    {
      appId: APP_ID,
      ownerId: OWNER_ID,
      configId: 'destination',
      createdBefore: repo.requests[0]!.createdBefore,
      state: 'failed',
      message: 'Storage migration did not start within 15 minutes. Please retry.',
    },
  ]);
});

test('a failed restoration does not prevent other apps recovering and is retried on another pass', async () => {
  const repo = new RecoveryRepository();
  repo.rows = [
    { app_id: APP_ID, owner_id: OWNER_ID, config_id: 'unavailable' },
    { app_id: APP_ID, owner_id: OWNER_ID, config_id: 'other' },
  ];
  repo.failConfigId = 'unavailable';
  await service(repo).sweepAbandoned();
  expect(repo.attempts.map((attempt) => attempt.configId)).toEqual(['unavailable', 'other']);
  repo.failConfigId = undefined;
  await service(repo).sweepAbandoned();
  expect(repo.attempts.map((attempt) => attempt.configId)).toEqual([
    'unavailable',
    'other',
    'unavailable',
    'other',
  ]);
});

test('apps without pending storage requests receive no writes', async () => {
  const repo = new RecoveryRepository();
  await service(repo).sweepAbandoned();
  expect(repo.attempts).toEqual([]);
});

test('status returns null for an owned app without a migration and hides unowned apps', async () => {
  const repo = new RecoveryRepository();
  const input = { appId: APP_ID, ownerId: OWNER_ID };
  expect(await service(repo).get(input)).toBeNull();
  repo.owned = false;
  await expect(service(repo).get(input)).rejects.toBeInstanceOf(NotFoundError);
  expect(repo.reads).toEqual([input, input]);
  expect(repo.cancellations).toEqual([]);
});

test('status exposes only the current config, state, message and safe cancellation availability', async () => {
  const repo = new RecoveryRepository();
  repo.migration = migrationRow();
  expect(await service(repo).get({ appId: APP_ID, ownerId: OWNER_ID })).toEqual({
    configId: 'destination',
    state: 'pending',
    message: null,
    canCancel: true,
  });
  repo.migration = migrationRow({ volume_storage_migration_started_at: new Date() });
  expect((await service(repo).get({ appId: APP_ID, ownerId: OWNER_ID }))?.canCancel).toBe(false);
  for (const state of ['completed', 'failed', 'cancelled'] as const) {
    repo.migration = migrationRow({ state });
    expect((await service(repo).get({ appId: APP_ID, ownerId: OWNER_ID }))?.canCancel).toBe(false);
  }
});

test('cancellation passes the client config token to the atomic unstarted-only abort', async () => {
  const repo = new RecoveryRepository();
  repo.migration = migrationRow();
  await service(repo).cancel({ appId: APP_ID, ownerId: OWNER_ID, configId: 'destination' });
  expect(repo.cancellations).toEqual([
    {
      appId: APP_ID,
      ownerId: OWNER_ID,
      configId: 'destination',
      state: 'cancelled',
      message: null,
    },
  ]);
});

test('a changed attempt or concurrent host claim refuses cancellation without retrying', async () => {
  const repo = new RecoveryRepository();
  repo.migration = migrationRow({ config_id: 'new-attempt' });
  repo.cancelled = false;
  await expect(
    service(repo).cancel({
      appId: APP_ID,
      ownerId: OWNER_ID,
      configId: 'old-attempt',
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(repo.cancellations).toHaveLength(1);
  expect(repo.cancellations[0]?.configId).toBe('old-attempt');
});

test('missing migrations cannot be cancelled and repeated cancellation needs no further writes', async () => {
  const repo = new RecoveryRepository();
  const input = { appId: APP_ID, ownerId: OWNER_ID, configId: 'destination' };
  await expect(service(repo).cancel(input)).rejects.toBeInstanceOf(NotFoundError);
  repo.migration = migrationRow({ state: 'cancelled' });
  await service(repo).cancel(input);
  expect(repo.cancellations).toEqual([]);
});

import { expect, test } from 'bun:test';
import type {
  UnstartedVolumeStorageMigrationRow,
  VolumeStorageMigrationsRepositoryContract,
} from '#repositories/volume-storage-migrations.repository.ts';
import { VolumeStorageMigrationsService } from '#services/volume-storage-migrations.service.ts';
import { APP_ID, OWNER_ID } from '#tests/services/support/fixtures.ts';

const EXPECTED_TIMEOUT_MS = 900_000;
const EXPECTED_BATCH_SIZE = 8;

type AbortUnstartedInput = Parameters<
  VolumeStorageMigrationsRepositoryContract['abortUnstarted']
>[0];

class RecoveryRepository
  implements Pick<VolumeStorageMigrationsRepositoryContract, 'listUnstarted' | 'abortUnstarted'>
{
  readonly attempts: AbortUnstartedInput[] = [];
  readonly requests: Parameters<VolumeStorageMigrationsRepositoryContract['listUnstarted']>[0][] =
    [];
  rows: UnstartedVolumeStorageMigrationRow[] = [];
  failConfigId: string | undefined;

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

test('recovery uses the immutable request age and bounds work per host report', async () => {
  const repo = new RecoveryRepository();
  repo.rows = [{ app_id: APP_ID, owner_id: OWNER_ID, config_id: 'destination' }];
  const before = Date.now();
  await new VolumeStorageMigrationsService(repo).sweepAbandoned();
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
  await new VolumeStorageMigrationsService(repo).sweepAbandoned();
  expect(repo.attempts.map((attempt) => attempt.configId)).toEqual(['unavailable', 'other']);
  repo.failConfigId = undefined;
  await new VolumeStorageMigrationsService(repo).sweepAbandoned();
  expect(repo.attempts.map((attempt) => attempt.configId)).toEqual([
    'unavailable',
    'other',
    'unavailable',
    'other',
  ]);
});

test('apps without pending storage requests receive no writes', async () => {
  const repo = new RecoveryRepository();
  await new VolumeStorageMigrationsService(repo).sweepAbandoned();
  expect(repo.attempts).toEqual([]);
});

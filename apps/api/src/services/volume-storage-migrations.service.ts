import type { VolumeStorageMigrationsRepositoryContract } from '#repositories/volume-storage-migrations.repository.ts';
import { Service } from '#services/service.ts';

const QUEUED_TIMEOUT_MINUTES = 15;
const MS_PER_MINUTE = 60_000;
const QUEUED_TIMEOUT_MS = QUEUED_TIMEOUT_MINUTES * MS_PER_MINUTE;
const RECOVERY_BATCH_SIZE = 8;

export class VolumeStorageMigrationsService extends Service {
  constructor(
    private readonly migrationsRepo: Pick<
      VolumeStorageMigrationsRepositoryContract,
      'listUnstarted' | 'abortUnstarted'
    >,
  ) {
    super();
  }

  async sweepAbandoned(): Promise<void> {
    const createdBefore = new Date(Date.now() - QUEUED_TIMEOUT_MS);
    const migrations = await this.migrationsRepo.listUnstarted({
      createdBefore,
      limit: RECOVERY_BATCH_SIZE,
    });
    for (const migration of migrations) {
      try {
        await this.migrationsRepo.abortUnstarted({
          appId: migration.app_id,
          ownerId: migration.owner_id,
          configId: migration.config_id,
          createdBefore,
          state: 'failed',
          message: `Storage migration did not start within ${QUEUED_TIMEOUT_MINUTES} minutes. Please retry.`,
        });
      } catch (error) {
        this.logger.error('unstarted storage migration recovery failed', {
          appId: migration.app_id,
          error,
        });
      }
    }
  }
}

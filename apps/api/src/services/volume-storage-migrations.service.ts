import type { AppId } from '@repo/protocol';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { VolumeStorageMigration } from '#lib/api/volume-storage-migration.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  VolumeStorageMigrationRow,
  VolumeStorageMigrationsRepositoryContract,
} from '#repositories/volume-storage-migrations.repository.ts';
import type { AppOwnershipRepositoryContract } from '#services/artifacts.service.ts';
import { Service } from '#services/service.ts';

const QUEUED_TIMEOUT_MINUTES = 15;
const MS_PER_MINUTE = 60_000;
const QUEUED_TIMEOUT_MS = QUEUED_TIMEOUT_MINUTES * MS_PER_MINUTE;
const RECOVERY_BATCH_SIZE = 8;

export type VolumeStorageMigrationStatusRepositoryContract = Pick<
  VolumeStorageMigrationsRepositoryContract,
  'listUnstarted' | 'abortUnstarted' | 'findByApp' | 'abort'
>;

export class VolumeStorageMigrationsService extends Service {
  private readonly migrationsRepo: VolumeStorageMigrationStatusRepositoryContract;
  private readonly appsRepo: AppOwnershipRepositoryContract;

  constructor({
    migrationsRepo,
    appsRepo,
  }: {
    migrationsRepo: VolumeStorageMigrationStatusRepositoryContract;
    appsRepo: AppOwnershipRepositoryContract;
  }) {
    super();
    this.migrationsRepo = migrationsRepo;
    this.appsRepo = appsRepo;
  }

  async get(input: { appId: AppId; ownerId: OwnerId }): Promise<VolumeStorageMigration | null> {
    const migration = await this.migrationsRepo.findByApp(input);
    if (migration) {
      return toMigration(migration);
    }
    if (!(await this.appsRepo.isOwnedBy(input))) {
      throw new NotFoundError('App not found.');
    }
    return null;
  }

  async cancel({
    appId,
    ownerId,
    configId,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    configId: string;
  }): Promise<void> {
    const migration = await this.migrationsRepo.findByApp({ appId, ownerId });
    if (!migration) {
      throw new NotFoundError('Storage migration not found.');
    }
    if (migration.state === 'cancelled') {
      return;
    }
    const cancelled = await this.migrationsRepo.abort({
      appId,
      ownerId,
      configId,
      state: 'cancelled',
      message: null,
    });
    if (!cancelled) {
      throw new ConflictError('The storage migration has started or changed. Refresh its status.');
    }
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

function toMigration(row: VolumeStorageMigrationRow): VolumeStorageMigration {
  return {
    configId: row.config_id,
    state: row.state,
    message: row.message,
    canCancel: row.state === 'pending' && row.volume_storage_migration_started_at === null,
  };
}

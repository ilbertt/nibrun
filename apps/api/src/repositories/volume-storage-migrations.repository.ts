import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import { type AppId, type DeploymentId, type HostId, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import type { Queries } from '#db/queries.gen.ts';
import type { ArtifactId, OwnerId } from '#lib/api/identifiers.ts';
import type { VolumeStorageMigrationState } from '#lib/api/volume-storage-migration.ts';
import { ConflictError } from '#lib/errors.ts';
import type { StoredVolumeStorage } from '#lib/volume-storage.ts';
import { appendConfigVersion, lockApp } from '#repositories/apps.repository.ts';
import { supersedeLiveDeployment } from '#repositories/deployments.repository.ts';
import { Repository } from '#repositories/repository.ts';

export type VolumeStorageMigrationRow = Queries['SelectVolumeStorageMigration'];
export type UnstartedVolumeStorageMigrationRow = Queries['SelectUnstartedVolumeStorageMigrations'];
export type VolumeStorageMigrationDestination = Omit<
  StoredVolumeStorage,
  'volume_storage_prefix'
> & {
  [Key in
    | 'volume_storage_endpoint'
    | 'volume_storage_bucket'
    | 'volume_storage_auth_kind'
    | 'volume_storage_encryption_password']: NonNullable<StoredVolumeStorage[Key]>;
};
type OwnedApp = { appId: AppId; ownerId: OwnerId };
type MigrationAttempt = OwnedApp & { configId: string };
type TransactionInput = OwnedApp & { tx: TypedSQL<Queries> };
export type RequestVolumeStorageMigrationInput = OwnedApp & {
  destination: VolumeStorageMigrationDestination;
};
export type AbortVolumeStorageMigrationInput = MigrationAttempt & {
  state: Extract<VolumeStorageMigrationState, 'failed' | 'cancelled'>;
  message: string | null;
};

export abstract class VolumeStorageMigrationsRepositoryContract {
  abstract request(
    input: RequestVolumeStorageMigrationInput,
  ): Promise<VolumeStorageMigrationRow | null>;
  abstract findByApp(input: OwnedApp): Promise<VolumeStorageMigrationRow | null>;
  abstract start(input: MigrationAttempt & { hostId: HostId }): Promise<boolean>;
  abstract cutover(input: MigrationAttempt & { hostId: HostId }): Promise<DeploymentId | null>;
  abstract complete(input: MigrationAttempt & { hostId: HostId }): Promise<boolean>;
  abstract listUnstarted(input: {
    createdBefore: Date;
    limit: number;
  }): Promise<UnstartedVolumeStorageMigrationRow[]>;
  abstract abortUnstarted(
    input: AbortVolumeStorageMigrationInput & { createdBefore: Date },
  ): Promise<boolean>;
  abstract abort(input: AbortVolumeStorageMigrationInput): Promise<boolean>;
  abstract abortStarted(
    input: AbortVolumeStorageMigrationInput & { hostId: HostId },
  ): Promise<boolean>;
}

export class VolumeStorageMigrationsRepository
  extends Repository
  implements VolumeStorageMigrationsRepositoryContract
{
  request({
    appId,
    ownerId,
    destination,
  }: RequestVolumeStorageMigrationInput): Promise<VolumeStorageMigrationRow | null> {
    return this.sql.begin(async (tx) => {
      const app = await lockApp({ tx, appId, ownerId });
      if (!app || (app.state !== 'active' && app.state !== 'suspended')) {
        return null;
      }
      if (app.volume_storage_migration_state === 'pending') {
        return this.read({ tx, appId, ownerId });
      }
      const source = await this.deployedConfig({ tx, appId, ownerId });
      if (!source || source.volume_storage_endpoint !== null) {
        return null;
      }
      const [inFlightExport] = await tx.SelectExportBlockingVolumeStorageMigration`
        SELECT e.id
        FROM nibrun.exports e
        JOIN nibrun.apps a ON a.id = e.app_id
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
          AND e.state IN ('pending', 'preparing')
        LIMIT 1
      `;
      if (inFlightExport) {
        throw new ConflictError('Cannot migrate app storage while an export is in progress.');
      }
      await appendConfigVersion({
        tx,
        appId,
        patch: {},
        storage: {
          ...destination,
          volume_storage_prefix: Value.Parse(
            ObjectKeySchema,
            `apps/${appId}/${crypto.randomUUID()}/`,
          ),
        },
      });
      await tx.MarkVolumeStorageMigrationPending`
        UPDATE nibrun.apps
        SET volume_storage_migration_state = 'pending', volume_storage_migration_message = NULL,
            volume_storage_migration_started_at = NULL, volume_storage_migration_host_id = NULL
        WHERE id = ${appId} AND owner_id = ${ownerId}
      `;
      return this.read({ tx, appId, ownerId });
    });
  }

  findByApp(input: OwnedApp): Promise<VolumeStorageMigrationRow | null> {
    return this.read({ ...input, tx: this.sql });
  }

  // A worker must win this transition before issuing any host-side work, including after a restart.
  start({
    appId,
    ownerId,
    configId,
    hostId,
  }: MigrationAttempt & { hostId: HostId }): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const app = await lockApp({ tx, appId, ownerId });
      if (
        app?.volume_storage_migration_state !== 'pending' ||
        app.volume_storage_migration_started_at !== null
      ) {
        return false;
      }
      const migration = await this.read({ tx, appId, ownerId });
      if (migration?.config_id !== configId) {
        return false;
      }
      await tx.StartVolumeStorageMigration`
        UPDATE nibrun.apps
        SET volume_storage_migration_started_at = now(), volume_storage_migration_host_id = ${hostId}
        WHERE id = ${appId} AND owner_id = ${ownerId}
      `;
      return true;
    });
  }

  // The owning host must verify the copy and prevent source access before requesting cutover.
  cutover({
    appId,
    ownerId,
    configId,
    hostId,
  }: MigrationAttempt & { hostId: HostId }): Promise<DeploymentId | null> {
    return this.sql.begin(async (tx) => {
      const app = await lockApp({ tx, appId, ownerId });
      if (
        !app ||
        (app.volume_storage_migration_state !== 'pending' &&
          app.volume_storage_migration_state !== 'completed') ||
        app.volume_storage_migration_started_at === null ||
        app.volume_storage_migration_host_id !== hostId
      ) {
        return null;
      }
      const migration = await this.read({ tx, appId, ownerId });
      if (migration?.config_id !== configId || migration.volume_storage_endpoint === null) {
        return null;
      }
      const deployed = await this.deployedConfig({ tx, appId, ownerId });
      if (!deployed) {
        return null;
      }
      if (deployed.config_id === configId) {
        return deployed.deployment_id;
      }
      if (
        app.volume_storage_migration_state !== 'pending' ||
        deployed.volume_storage_endpoint !== null
      ) {
        return null;
      }
      return this.deployDestination({
        tx,
        appId,
        ownerId,
        configId,
        artifactId: deployed.artifact_id,
      });
    });
  }

  // The owning host must verify the copy and stop source access before acknowledging cutover.
  complete({
    appId,
    ownerId,
    configId,
    hostId,
  }: MigrationAttempt & { hostId: HostId }): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const app = await lockApp({ tx, appId, ownerId });
      if (
        !app ||
        (app.volume_storage_migration_state !== 'pending' &&
          app.volume_storage_migration_state !== 'completed') ||
        app.volume_storage_migration_started_at === null ||
        app.volume_storage_migration_host_id !== hostId
      ) {
        return false;
      }
      const migration = await this.read({ tx, appId, ownerId });
      if (migration?.config_id !== configId || migration.volume_storage_endpoint === null) {
        return false;
      }
      const deployed = await this.deployedConfig({ tx, appId, ownerId });
      if (deployed?.config_id !== configId) {
        return false;
      }
      if (app.volume_storage_migration_state === 'completed') {
        return true;
      }
      await tx.CompleteVolumeStorageMigration`
        UPDATE nibrun.apps
        SET volume_storage_migration_state = 'completed', volume_storage_migration_message = NULL
        WHERE id = ${appId} AND owner_id = ${ownerId}
      `;
      return true;
    });
  }

  listUnstarted({ createdBefore, limit }: { createdBefore: Date; limit: number }) {
    return this.sql.SelectUnstartedVolumeStorageMigrations`
      /* @notNull config_id */
      SELECT a.id AS app_id, a.owner_id, c.id AS config_id
      FROM nibrun.apps a
      JOIN LATERAL (
        SELECT c.id, c.created_at FROM nibrun.app_configs c
        WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.volume_storage_migration_state = 'pending'
        AND a.volume_storage_migration_started_at IS NULL
        AND a.state IN ('active', 'suspended') AND c.created_at < ${createdBefore}
      ORDER BY c.id LIMIT ${limit}
    `;
  }

  abortUnstarted(input: AbortVolumeStorageMigrationInput & { createdBefore: Date }) {
    return this.restore({ ...input, unstartedBefore: input.createdBefore, hostId: undefined });
  }

  abort(input: AbortVolumeStorageMigrationInput): Promise<boolean> {
    return this.restore({ ...input, unstartedBefore: undefined, hostId: undefined });
  }

  // Only after this host confirms the destination writer and copy work have stopped for this attempt.
  abortStarted(input: AbortVolumeStorageMigrationInput & { hostId: HostId }): Promise<boolean> {
    return this.restore({ ...input, unstartedBefore: undefined });
  }

  private restore({
    appId,
    ownerId,
    configId,
    state,
    message,
    unstartedBefore,
    hostId,
  }: AbortVolumeStorageMigrationInput & {
    unstartedBefore: Date | undefined;
    hostId: HostId | undefined;
  }): Promise<boolean> {
    return this.sql.begin(async (tx) => {
      const app = await lockApp({ tx, appId, ownerId });
      if (app?.volume_storage_migration_state !== 'pending') {
        return false;
      }
      const expectedHostId =
        app.volume_storage_migration_started_at === null
          ? undefined
          : app.volume_storage_migration_host_id;
      if (hostId !== expectedHostId) {
        return false;
      }
      const migration = await this.read({ tx, appId, ownerId });
      if (migration?.config_id !== configId) {
        return false;
      }
      if (unstartedBefore !== undefined && migration.created_at >= unstartedBefore) {
        return false;
      }
      const source = await this.deployedConfig({ tx, appId, ownerId });
      if (!source || source.volume_storage_endpoint !== null) {
        return false;
      }
      await appendConfigVersion({ tx, appId, patch: {}, storage: source });
      await tx.AbortVolumeStorageMigration`
        UPDATE nibrun.apps
        SET volume_storage_migration_state = ${state}, volume_storage_migration_message = ${message}
        WHERE id = ${appId} AND owner_id = ${ownerId}
      `;
      return true;
    });
  }

  private async deployDestination({
    tx,
    appId,
    ownerId,
    configId,
    artifactId,
  }: TransactionInput & { configId: string; artifactId: ArtifactId }): Promise<DeploymentId> {
    await supersedeLiveDeployment({ tx, appId, ownerId });
    const [inserted] = await tx.InsertVolumeStorageMigrationDeployment`
      INSERT INTO nibrun.deployments (app_id, artifact_id, config_id)
      SELECT a.id, ${artifactId}, ${configId}
      FROM nibrun.apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.state IN ('active', 'suspended')
      RETURNING id
    `;
    if (!inserted) {
      throw new ConflictError(
        'The app changed before its storage migration could switch deployments.',
      );
    }
    return inserted.id;
  }

  private async deployedConfig({ tx, appId, ownerId }: TransactionInput) {
    const [row] = await tx.SelectVolumeStorageMigrationSource`
      SELECT d.id AS deployment_id, d.artifact_id, c.id AS config_id,
             c.volume_storage_endpoint, c.volume_storage_bucket, c.volume_storage_prefix,
             c.volume_storage_region, c.volume_storage_auth_kind, c.volume_storage_access_key_id,
             c.volume_storage_secret_access_key, c.volume_storage_session_token,
             c.volume_storage_encryption_password
      FROM nibrun.apps a
      JOIN LATERAL (
        SELECT id, artifact_id, config_id FROM nibrun.deployments d
        WHERE d.app_id = a.id ORDER BY d.id DESC LIMIT 1
      ) d ON true
      JOIN nibrun.app_configs c ON c.id = d.config_id AND c.app_id = a.id
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.state IN ('active', 'suspended')
    `;
    return row;
  }

  private async read({
    tx,
    appId,
    ownerId,
  }: TransactionInput): Promise<VolumeStorageMigrationRow | null> {
    const [row] = await tx.SelectVolumeStorageMigration`
      /* @notNull state */
      SELECT a.id AS app_id, a.volume_storage_migration_state AS state,
             a.volume_storage_migration_message AS message, a.updated_at,
             a.volume_storage_migration_started_at, a.volume_storage_migration_host_id,
             c.id AS config_id, c.created_at, c.volume_storage_endpoint, c.volume_storage_bucket,
             c.volume_storage_prefix, c.volume_storage_region, c.volume_storage_auth_kind
      FROM nibrun.apps a
      JOIN LATERAL (
        SELECT * FROM nibrun.app_configs c WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND a.state <> 'deleted'
        AND a.volume_storage_migration_state IS NOT NULL
    `;
    return row ?? null;
  }
}

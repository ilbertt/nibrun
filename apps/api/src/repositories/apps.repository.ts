import type { TypedSQL } from '@ilbertt/bun-sqlgen';
import type {
  AppHostnameKind,
  AppHostnameState,
  AppId,
  AppState,
  DnsLabel,
  Hostname,
  ObjectKey,
  OwnerId,
} from '@repo/protocol';
import type { ArrayType } from 'bun';
import type { Queries } from '#db/queries.gen.ts';
import { type SealedConfigPatch, type StoredAppConfig, toAppConfig } from '#lib/app-config.ts';
import type { SealedEnvironment } from '#lib/tenant-secrets.ts';
import type { AppHostnameRow } from '#repositories/app-hostnames.repository.ts';
import { Repository } from '#repositories/repository.ts';

/**
 * `sql.array` encodes as JSON when the element type is left out, and `text[]` reads that JSON
 * back element by element — so the arguments would arrive quoted rather than rejected. Naming
 * the type is what makes the column and the parameter agree.
 */
const TEXT_ARRAY: ArrayType = 'TEXT';

export type AppRow = Queries['SelectAppById'];

export type CreatedApp = { app: AppRow; hostnames: AppHostnameRow[] };

/**
 * The objects a deleted app still has behind it, ready to be removed before the rows naming them
 * are.
 *
 * `artifacts` is only the keys no surviving app still names. An artifact key is the digest of the
 * bytes and nothing else, so two apps that were deployed from the same binary are two rows over
 * one object — and deleting it for the app that is going would take the binary out from under the
 * one that stays. The last of them to be deleted is the one that finds it unreferenced.
 */
export type Leftovers = { artifacts: ObjectKey[]; exports: ObjectKey[] };

type OwnedApp = { appId: AppId; ownerId: OwnerId };

export abstract class AppsRepositoryContract {
  abstract create(input: {
    ownerId: OwnerId;
    slug: DnsLabel;
    hostname: Hostname;
    config: StoredAppConfig;
  }): Promise<CreatedApp>;
  abstract listByOwner(input: { ownerId: OwnerId }): Promise<AppRow[]>;
  abstract findById(input: OwnedApp): Promise<AppRow | null>;
  abstract updateConfig(input: OwnedApp & { patch: SealedConfigPatch }): Promise<AppRow | null>;
  abstract updateState(input: OwnedApp & { state: AppState }): Promise<AppRow | null>;
  abstract finishDeleting(input: { appId: AppId }): Promise<boolean>;
  abstract isDeletionFinishable(input: { appId: AppId }): Promise<boolean>;
  abstract listFinishableDeletions(input: { limit: number }): Promise<AppId[]>;
  abstract isOwnedBy(input: OwnedApp): Promise<boolean>;
  abstract listPurgeable(input: { limit: number }): Promise<AppId[]>;
  abstract listLeftovers(input: { appId: AppId }): Promise<Leftovers>;
  abstract purge(input: { appId: AppId }): Promise<void>;
}

export const PLATFORM_KIND: AppHostnameKind = 'platform';

const ACTIVE_STATE: AppHostnameState = 'active';

export class AppsRepository extends Repository implements AppsRepositoryContract {
  async isOwnedBy({ appId, ownerId }: OwnedApp): Promise<boolean> {
    const [row] = await this.sql.SelectAppOwnership`
      SELECT a.id
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return row !== undefined;
  }

  create({
    ownerId,
    slug,
    hostname,
    config,
  }: {
    ownerId: OwnerId;
    slug: DnsLabel;
    hostname: Hostname;
    config: StoredAppConfig;
  }): Promise<CreatedApp> {
    return this.sql.begin(async (tx) => {
      const [inserted] = await tx.InsertApp`
        INSERT INTO nibrun.apps (owner_id, slug)
        VALUES (${ownerId}, ${slug})
        RETURNING id
      `;
      if (!inserted) {
        throw new Error('Inserting into nibrun.apps returned no row.');
      }

      const [insertedConfig] = await tx.InsertAppConfig`
        INSERT INTO nibrun.app_configs (
          app_id, guest_port, args, vcpu_count, memory_mib,
          health_check_path, health_check_interval_ms, health_check_timeout_ms,
          health_check_grace_period_ms, health_check_healthy_threshold,
          health_check_unhealthy_threshold,
          restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
          restart_backoff_factor, restart_reset_after_ms
        )
        VALUES (
          ${inserted.id}, ${config.guestPort}, ${tx.array(config.args, TEXT_ARRAY)},
          ${config.resources.vcpuCount}, ${config.resources.memoryMib},
          ${config.healthCheck.path ?? null}, ${config.healthCheck.intervalMs},
          ${config.healthCheck.timeoutMs}, ${config.healthCheck.gracePeriodMs},
          ${config.healthCheck.healthyThreshold}, ${config.healthCheck.unhealthyThreshold},
          ${config.restartPolicy.maxRestarts}, ${config.restartPolicy.initialBackoffMs},
          ${config.restartPolicy.maxBackoffMs}, ${config.restartPolicy.backoffFactor},
          ${config.restartPolicy.resetAfterMs}
        )
        RETURNING id
      `;
      if (!insertedConfig) {
        throw new Error('Inserting into nibrun.app_configs returned no row.');
      }

      await insertEnvironment({
        tx,
        configId: insertedConfig.id,
        environment: config.environment,
      });

      // Active on insert: the wildcard record and the wildcard certificate already cover this
      // name, so there is nothing for it to wait for. Only a brought domain has to be proved.
      const [hostnameRow] = await tx.InsertAppHostname`
        INSERT INTO nibrun.app_hostnames (app_id, hostname, kind, state)
        VALUES (${inserted.id}, ${hostname}, ${PLATFORM_KIND}, ${ACTIVE_STATE})
        RETURNING hostname, kind, state, dcv_target
      `;
      if (!hostnameRow) {
        throw new Error('Inserting into nibrun.app_hostnames returned no row.');
      }

      const [app] = await tx.SelectCreatedApp`
        /* @notNull environment_names */
        SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
        FROM nibrun.live_apps a
        JOIN LATERAL (
          SELECT * FROM nibrun.app_configs_with_environment c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${inserted.id} AND a.owner_id = ${ownerId}
      `;
      if (!app) {
        throw new Error('Reading back the created app returned no row.');
      }

      return { app, hostnames: [hostnameRow] };
    });
  }

  listByOwner({ ownerId }: { ownerId: OwnerId }): Promise<AppRow[]> {
    return this.sql.SelectAppsByOwner`
      /* @notNull environment_names */
      SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT * FROM nibrun.app_configs_with_environment c
        WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.owner_id = ${ownerId}
      ORDER BY a.created_at DESC
    `;
  }

  async findById({ appId, ownerId }: OwnedApp): Promise<AppRow | null> {
    const [app] = await this.sql.SelectAppById`
      /* @notNull environment_names */
      SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT * FROM nibrun.app_configs_with_environment c
        WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return app ?? null;
  }

  // A patch appends a version rather than editing one, and the newest version is the live one,
  // so the write is a single INSERT. `FOR UPDATE` is what stops two concurrent patches reading
  // the same starting config and the later INSERT silently dropping the earlier one's fields.
  updateConfig({ appId, ownerId, patch }: OwnedApp & { patch: SealedConfigPatch }) {
    return this.sql.begin(async (tx) => {
      const [locked] = await tx.SelectAppForConfigUpdate`
        SELECT a.id
        FROM nibrun.live_apps a
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
        FOR UPDATE
      `;
      if (!locked) {
        return null;
      }

      const [current] = await tx.SelectCurrentAppConfig`
        /* @notNull environment_names */
        SELECT c.id, c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
        FROM nibrun.app_configs_with_environment c
        WHERE c.app_id = ${appId}
        ORDER BY c.id DESC
        LIMIT 1
      `;
      if (!current) {
        throw new Error('An app exists with no config.');
      }

      const config = { ...toAppConfig(current), ...patch };

      const [inserted] = await tx.InsertPatchedAppConfig`
        INSERT INTO nibrun.app_configs (
          app_id, guest_port, args, vcpu_count, memory_mib,
          health_check_path, health_check_interval_ms, health_check_timeout_ms,
          health_check_grace_period_ms, health_check_healthy_threshold,
          health_check_unhealthy_threshold,
          restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
          restart_backoff_factor, restart_reset_after_ms
        )
        VALUES (
          ${appId}, ${config.guestPort}, ${tx.array(config.args, TEXT_ARRAY)},
          ${config.resources.vcpuCount}, ${config.resources.memoryMib},
          ${config.healthCheck.path ?? null}, ${config.healthCheck.intervalMs},
          ${config.healthCheck.timeoutMs}, ${config.healthCheck.gracePeriodMs},
          ${config.healthCheck.healthyThreshold}, ${config.healthCheck.unhealthyThreshold},
          ${config.restartPolicy.maxRestarts}, ${config.restartPolicy.initialBackoffMs},
          ${config.restartPolicy.maxBackoffMs}, ${config.restartPolicy.backoffFactor},
          ${config.restartPolicy.resetAfterMs}
        )
        RETURNING id
      `;
      if (!inserted) {
        throw new Error('Inserting into nibrun.app_configs returned no row.');
      }

      // Everything the patch said nothing about, which is every variable there is when it said
      // nothing at all. A name it sets or removes is left out of the copy: one row per name per
      // version, and for a name it sets that row is the one inserted below.
      const environment = patch.environment ?? { set: {}, removed: [] };
      const edited = new Set([...Object.keys(environment.set), ...environment.removed]);
      await carryEnvironmentForward({
        tx,
        fromConfigId: current.id,
        toConfigId: inserted.id,
        names: current.environment_names.filter((name) => !edited.has(name)),
      });
      await insertEnvironment({ tx, configId: inserted.id, environment: environment.set });

      // Reconfiguring an app changes the app, but the new version lands in another table, so
      // nothing would move `updated_at` without this.
      const [app] = await tx.TouchAppAfterConfigPatch`
        /* @notNull environment_names */
        UPDATE nibrun.apps a
        SET updated_at = now()
        FROM nibrun.app_configs_with_environment c
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND c.id = ${inserted.id}
        RETURNING a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
                  c.guest_port, c.args, c.vcpu_count, c.memory_mib,
                  c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
                  c.health_check_grace_period_ms, c.health_check_healthy_threshold,
                  c.health_check_unhealthy_threshold,
                  c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
                  c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
      `;
      return app ?? null;
    });
  }

  /**
   * The fleet's view rather than an owner's, so there is no `ownerId` to scope on: an app is
   * deleted once the host holding its filesystem says the filesystem is gone.
   *
   * `state = 'deleting'` in the predicate rather than around it. A host reports the same volume
   * every heartbeat until desired state stops mentioning it, so this is asked many times for one
   * deletion, and what comes back says which of them was the one that finished it.
   */
  /** The app just asked for, so that an owner is told what became of it rather than to wait. */
  async isDeletionFinishable({ appId }: { appId: AppId }): Promise<boolean> {
    const rows = await this.sql.SelectFinishableDeletion`
      SELECT f.app_id FROM nibrun.finishable_deletions f WHERE f.app_id = ${appId}
    `;
    return rows.length > 0;
  }

  /**
   * The ones nobody is waiting on any more — apps left `deleting` from before a deletion could
   * finish itself. Bounded: this is asked on the way through a host report, and what it usually
   * finds is nothing.
   */
  async listFinishableDeletions({ limit }: { limit: number }): Promise<AppId[]> {
    const rows = await this.sql.SelectFinishableDeletions`
      SELECT f.app_id FROM nibrun.finishable_deletions f LIMIT ${limit}
    `;
    return rows.map((row) => row.app_id);
  }

  async finishDeleting({ appId }: { appId: AppId }): Promise<boolean> {
    const rows = await this.sql.FinishDeletingApp`
      UPDATE nibrun.apps SET state = 'deleted'
      WHERE id = ${appId} AND state = 'deleting'
      RETURNING id
    `;
    return rows.length > 0;
  }

  /**
   * Apps whose filesystem is gone and whose binaries and bundles are not. Bounded, because this
   * is asked on the way through a host report and the answer is almost always empty — a backlog
   * is drained a batch per report rather than held open on one.
   */
  async listPurgeable({ limit }: { limit: number }): Promise<AppId[]> {
    const rows = await this.sql.SelectPurgeableApps`
      SELECT p.app_id FROM nibrun.purgeable_apps p LIMIT ${limit}
    `;
    return rows.map((row) => row.app_id);
  }

  /**
   * Read while the rows still name them, so an object is only ever deleted on the strength of a
   * row that says it should be — and read as one query per kind rather than one per row, because
   * an app deployed a hundred times is a hundred rows over far fewer objects.
   */
  async listLeftovers({ appId }: { appId: AppId }): Promise<Leftovers> {
    const [artifacts, exports] = await Promise.all([
      this.sql.SelectUnsharedArtifactKeys`
        /* @notNull object_key */
        SELECT DISTINCT ar.object_key
        FROM nibrun.artifacts ar
        WHERE ar.app_id = ${appId}
          -- An upload that never completed named no object, so there is nothing of it to remove.
          AND ar.object_key IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM nibrun.artifacts other
            WHERE other.object_key = ar.object_key AND other.app_id <> ${appId}
          )
      `,
      this.sql.SelectExportKeysByApp`
        SELECT e.object_key FROM nibrun.exports e WHERE e.app_id = ${appId}
      `,
    ]);
    return {
      artifacts: artifacts.map((row) => row.object_key),
      exports: exports.map((row) => row.object_key),
    };
  }

  /**
   * Every row of the app's that names an object, in the order the foreign keys allow: exports and
   * deployments both point at artifacts with `ON DELETE RESTRICT`, so the artifact rows are last.
   * The app row itself stays — the slug must never be handed to a second app.
   *
   * A deployment made to replay an older one points at it, and one statement takes both: a
   * rollback only ever names a deployment of the same app, so there is no row left behind to
   * restrict the delete.
   *
   * One transaction, so an app is never half purged: what a second pass finds is either all of
   * this still to do or none of it.
   */
  purge({ appId }: { appId: AppId }): Promise<void> {
    return this.sql.begin(async (tx) => {
      await tx.DeleteExportsByApp`DELETE FROM nibrun.exports WHERE app_id = ${appId}`;
      await tx.DeleteDeploymentsByApp`DELETE FROM nibrun.deployments WHERE app_id = ${appId}`;
      await tx.DeleteArtifactsByApp`DELETE FROM nibrun.artifacts WHERE app_id = ${appId}`;
    });
  }

  updateState({ appId, ownerId, state }: OwnedApp & { state: AppState }) {
    return this.sql.begin(async (tx) => {
      const [updated] = await tx.UpdateAppState`
        UPDATE nibrun.apps
        SET state = ${state}
        WHERE id = ${appId} AND owner_id = ${ownerId} AND state <> 'deleted'
        RETURNING id
      `;
      if (!updated) {
        return null;
      }

      const [app] = await tx.SelectAppAfterStateChange`
        /* @notNull environment_names */
        SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms, c.environment_names
        FROM nibrun.live_apps a
        JOIN LATERAL (
          SELECT * FROM nibrun.app_configs_with_environment c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      `;
      return app ?? null;
    });
  }
}

/**
 * The variables a new config version inherits from the one before it, copied rather than read and
 * rewritten: the api has no reason to open a value it is only carrying forward, so the ciphertext
 * never leaves the database.
 *
 * Untagged for the reason the insert below is.
 */
async function carryEnvironmentForward({
  tx,
  fromConfigId,
  toConfigId,
  names,
}: {
  tx: TypedSQL<Queries>;
  fromConfigId: string;
  toConfigId: string;
  names: readonly string[];
}): Promise<void> {
  if (names.length === 0) {
    return;
  }

  await tx`
    INSERT INTO nibrun.app_config_environment (config_id, name, value)
    SELECT ${toConfigId}, e.name, e.value
    FROM nibrun.app_config_environment e
    WHERE e.config_id = ${fromConfigId} AND e.name = ANY(${tx.array([...names], TEXT_ARRAY)})
  `;
}

/**
 * One statement rather than one per variable: an environment is small, but a round trip each is
 * still a round trip inside the transaction that is holding the app's row.
 *
 * Nothing is written for an app that sets none, which is what keeps an empty environment from
 * being a statement with no rows to insert.
 */
async function insertEnvironment({
  tx,
  configId,
  environment,
}: {
  tx: TypedSQL<Queries>;
  configId: string;
  environment: SealedEnvironment;
}): Promise<void> {
  const names = Object.keys(environment);
  if (names.length === 0) {
    return;
  }

  // Untagged deliberately: `sql.array` is a clause the generator blanks out before it parses the
  // statement, and `UNNEST(, )` is not a statement. Naming a query is what opts it into
  // generation, so this opts out — there is no row type to lose, the insert returns none.
  //
  // The arrays are `sql.array` rather than plain ones because a bare JS array is serialised as a
  // comma-joined list, which Postgres reads as one malformed array literal rather than as many
  // values.
  await tx`
    INSERT INTO nibrun.app_config_environment (config_id, name, value)
    SELECT ${configId}, pair.name, pair.value
    FROM UNNEST(
      ${tx.array(names, TEXT_ARRAY)},
      ${tx.array(
        names.map((name) => environment[name] ?? ''),
        TEXT_ARRAY,
      )}
    ) AS pair(name, value)
  `;
}

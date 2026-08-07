import type {
  AppHostnameKind,
  AppId,
  AppState,
  DnsLabel,
  Hostname,
  ObjectKey,
  OwnerId,
} from '@repo/protocol';
import type { ArrayType } from 'bun';
import type { Queries } from '#db/queries.gen.d.ts';
import { type AppConfigPatch, type PublicAppConfig, toAppConfig } from '#lib/app-config.ts';
import { Repository } from '#repositories/repository.ts';

/**
 * `sql.array` encodes as JSON when the element type is left out, and `text[]` reads that JSON
 * back element by element — so the arguments would arrive quoted rather than rejected. Naming
 * the type is what makes the column and the parameter agree.
 */
const TENANT_ARGS_TYPE: ArrayType = 'TEXT';

export type AppRow = Queries['SelectAppById'];
export type AppHostnameRow = Queries['SelectAppHostnamesByApp'];
export type OwnedAppHostnameRow = Queries['SelectAppHostnamesByOwner'];

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
    config: PublicAppConfig;
  }): Promise<CreatedApp>;
  abstract listByOwner(input: { ownerId: OwnerId }): Promise<AppRow[]>;
  abstract listHostnamesByOwner(input: { ownerId: OwnerId }): Promise<OwnedAppHostnameRow[]>;
  abstract findById(input: OwnedApp): Promise<AppRow | null>;
  abstract listHostnamesByApp(input: OwnedApp): Promise<AppHostnameRow[]>;
  abstract updateConfig(input: OwnedApp & { patch: AppConfigPatch }): Promise<AppRow | null>;
  abstract updateState(input: OwnedApp & { state: AppState }): Promise<AppRow | null>;
  abstract finishDeleting(input: { appId: AppId }): Promise<boolean>;
  abstract hasDesiredVolume(input: { appId: AppId }): Promise<boolean>;
  abstract isOwnedBy(input: OwnedApp): Promise<boolean>;
  abstract listPurgeable(input: { limit: number }): Promise<AppId[]>;
  abstract listLeftovers(input: { appId: AppId }): Promise<Leftovers>;
  abstract purge(input: { appId: AppId }): Promise<void>;
}

export const PLATFORM_KIND: AppHostnameKind = 'platform';

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
    config: PublicAppConfig;
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

      await tx.InsertAppConfig`
        INSERT INTO nibrun.app_configs (
          app_id, guest_port, args, vcpu_count, memory_mib,
          health_check_path, health_check_interval_ms, health_check_timeout_ms,
          health_check_grace_period_ms, health_check_healthy_threshold,
          health_check_unhealthy_threshold,
          restart_max_restarts, restart_initial_backoff_ms, restart_max_backoff_ms,
          restart_backoff_factor, restart_reset_after_ms
        )
        VALUES (
          ${inserted.id}, ${config.guestPort}, ${tx.array(config.args, TENANT_ARGS_TYPE)},
          ${config.resources.vcpuCount}, ${config.resources.memoryMib},
          ${config.healthCheck.path ?? null}, ${config.healthCheck.intervalMs},
          ${config.healthCheck.timeoutMs}, ${config.healthCheck.gracePeriodMs},
          ${config.healthCheck.healthyThreshold}, ${config.healthCheck.unhealthyThreshold},
          ${config.restartPolicy.maxRestarts}, ${config.restartPolicy.initialBackoffMs},
          ${config.restartPolicy.maxBackoffMs}, ${config.restartPolicy.backoffFactor},
          ${config.restartPolicy.resetAfterMs}
        )
      `;

      const [hostnameRow] = await tx.InsertAppHostname`
        INSERT INTO nibrun.app_hostnames (app_id, hostname, kind)
        VALUES (${inserted.id}, ${hostname}, ${PLATFORM_KIND})
        RETURNING hostname, kind
      `;
      if (!hostnameRow) {
        throw new Error('Inserting into nibrun.app_hostnames returned no row.');
      }

      const [app] = await tx.SelectCreatedApp`
        /* @notNull created_at */
        SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
        FROM nibrun.live_apps a
        JOIN LATERAL (
          SELECT * FROM nibrun.app_configs c
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
      /* @notNull created_at */
      SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT * FROM nibrun.app_configs c
        WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.owner_id = ${ownerId}
      ORDER BY a.created_at DESC
    `;
  }

  listHostnamesByOwner({ ownerId }: { ownerId: OwnerId }): Promise<OwnedAppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByOwner`
      SELECT h.app_id, h.hostname, h.kind
      FROM nibrun.app_hostnames h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE a.owner_id = ${ownerId}
      ORDER BY h.app_id, h.hostname
    `;
  }

  async findById({ appId, ownerId }: OwnedApp): Promise<AppRow | null> {
    const [app] = await this.sql.SelectAppById`
      /* @notNull created_at */
      SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
             c.guest_port, c.args, c.vcpu_count, c.memory_mib,
             c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
             c.health_check_grace_period_ms, c.health_check_healthy_threshold,
             c.health_check_unhealthy_threshold,
             c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
             c.restart_backoff_factor, c.restart_reset_after_ms
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT * FROM nibrun.app_configs c
        WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
      ) c ON true
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
    `;
    return app ?? null;
  }

  listHostnamesByApp({ appId, ownerId }: OwnedApp): Promise<AppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByApp`
      SELECT h.hostname, h.kind
      FROM nibrun.app_hostnames h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE h.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY h.hostname
    `;
  }

  // A patch appends a version rather than editing one, and the newest version is the live one,
  // so the write is a single INSERT. `FOR UPDATE` is what stops two concurrent patches reading
  // the same starting config and the later INSERT silently dropping the earlier one's fields.
  updateConfig({ appId, ownerId, patch }: OwnedApp & { patch: AppConfigPatch }) {
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
        SELECT c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
        FROM nibrun.app_configs c
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
          ${appId}, ${config.guestPort}, ${tx.array(config.args, TENANT_ARGS_TYPE)},
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

      // Reconfiguring an app changes the app, but the new version lands in another table, so
      // nothing would move `updated_at` without this.
      const [app] = await tx.TouchAppAfterConfigPatch`
        /* @notNull created_at */
        UPDATE nibrun.apps a
        SET updated_at = now()
        FROM nibrun.app_configs c
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId} AND c.id = ${inserted.id}
        RETURNING a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
                  c.guest_port, c.args, c.vcpu_count, c.memory_mib,
                  c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
                  c.health_check_grace_period_ms, c.health_check_healthy_threshold,
                  c.health_check_unhealthy_threshold,
                  c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
                  c.restart_backoff_factor, c.restart_reset_after_ms
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
  /**
   * Whether any host will be told to hold or to let go of this app's filesystem. Read off the
   * view the hosts are served from, so it cannot answer one thing while they are told another.
   */
  async hasDesiredVolume({ appId }: { appId: AppId }): Promise<boolean> {
    const rows = await this.sql.SelectDesiredVolumeForApp`
      SELECT v.app_id FROM nibrun.desired_volumes v WHERE v.app_id = ${appId}
    `;
    return rows.length > 0;
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
        SELECT DISTINCT ar.object_key
        FROM nibrun.artifacts ar
        WHERE ar.app_id = ${appId}
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
        /* @notNull created_at */
        SELECT a.id, a.owner_id, a.slug, a.state, a.created_at, a.updated_at,
               c.guest_port, c.args, c.vcpu_count, c.memory_mib,
               c.health_check_path, c.health_check_interval_ms, c.health_check_timeout_ms,
               c.health_check_grace_period_ms, c.health_check_healthy_threshold,
               c.health_check_unhealthy_threshold,
               c.restart_max_restarts, c.restart_initial_backoff_ms, c.restart_max_backoff_ms,
               c.restart_backoff_factor, c.restart_reset_after_ms
        FROM nibrun.live_apps a
        JOIN LATERAL (
          SELECT * FROM nibrun.app_configs c
          WHERE c.app_id = a.id ORDER BY c.id DESC LIMIT 1
        ) c ON true
        WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      `;
      return app ?? null;
    });
  }
}

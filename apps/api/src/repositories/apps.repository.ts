import type { AppHostnameKind, AppId, AppState, DnsLabel, Hostname, OwnerId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { type AppConfigPatch, type PublicAppConfig, toAppConfig } from '#lib/app-config.ts';
import { Repository } from '#repositories/repository.ts';

export type AppRow = Queries['SelectAppById'];
export type AppHostnameRow = Queries['SelectAppHostnamesByApp'];
export type OwnedAppHostnameRow = Queries['SelectAppHostnamesByOwner'];

export type CreatedApp = { app: AppRow; hostnames: AppHostnameRow[] };

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
  abstract isOwnedBy(input: OwnedApp): Promise<boolean>;
}

export const PLATFORM_KIND: AppHostnameKind = 'platform';

export class AppsRepository extends Repository implements AppsRepositoryContract {
  async isOwnedBy({ appId, ownerId }: OwnedApp): Promise<boolean> {
    const [row] = await this.sql.SelectAppOwnership`
      SELECT a.id
      FROM nibrun.apps a
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
          ${inserted.id}, ${config.guestPort}, ${config.args},
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
        FROM nibrun.apps a
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
      FROM nibrun.apps a
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
      JOIN nibrun.apps a ON a.id = h.app_id
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
      FROM nibrun.apps a
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
      JOIN nibrun.apps a ON a.id = h.app_id
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
        FROM nibrun.apps a
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
          ${appId}, ${config.guestPort}, ${config.args},
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
  async finishDeleting({ appId }: { appId: AppId }): Promise<boolean> {
    const rows = await this.sql.FinishDeletingApp`
      UPDATE nibrun.apps SET state = 'deleted'
      WHERE id = ${appId} AND state = 'deleting'
      RETURNING id
    `;
    return rows.length > 0;
  }

  updateState({ appId, ownerId, state }: OwnedApp & { state: AppState }) {
    return this.sql.begin(async (tx) => {
      const [updated] = await tx.UpdateAppState`
        UPDATE nibrun.apps
        SET state = ${state}
        WHERE id = ${appId} AND owner_id = ${ownerId}
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
        FROM nibrun.apps a
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

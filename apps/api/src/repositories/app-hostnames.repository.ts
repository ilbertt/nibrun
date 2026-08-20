import type { AppHostnameKind, AppHostnameState, AppId, Hostname, OwnerId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type AppHostnameRow = Queries['SelectAppHostnamesByApp'];
export type OwnedAppHostnameRow = Queries['SelectAppHostnamesByOwner'];
export type PendingHostnameRow = Queries['SelectPendingCustomHostnames'];

type OwnedApp = { appId: AppId; ownerId: OwnerId };

export const CUSTOM_KIND: AppHostnameKind = 'custom';

/**
 * The names an app answers on.
 *
 * Its own concern rather than part of the app: an app is created once and read back, while a
 * brought domain has a life of its own — claimed, proved at the edge, and given up — against a
 * table nothing else writes. Minting the one nibrun issues stays with creating the app, because
 * that happens in the same transaction and an app without a hostname is not an app.
 */
export abstract class AppHostnamesRepositoryContract {
  abstract listByOwner(input: { ownerId: OwnerId }): Promise<OwnedAppHostnameRow[]>;
  abstract listByApp(input: OwnedApp): Promise<AppHostnameRow[]>;
  abstract addCustom(input: OwnedApp & { hostname: Hostname }): Promise<AppHostnameRow | null>;
  abstract attachCustom(input: {
    hostname: Hostname;
    cloudflareId: string;
    dcvTarget: string | null;
  }): Promise<AppHostnameRow | null>;
  abstract setCustomState(input: { hostname: Hostname; state: AppHostnameState }): Promise<boolean>;
  abstract removeCustom(input: OwnedApp & { hostname: Hostname }): Promise<string | null>;
  abstract listPendingCustom(input: { limit: number }): Promise<PendingHostnameRow[]>;
}

export class AppHostnamesRepository extends Repository implements AppHostnamesRepositoryContract {
  listByOwner({ ownerId }: { ownerId: OwnerId }): Promise<OwnedAppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByOwner`
      SELECT h.app_id, h.hostname, h.kind, h.state, h.dcv_target
      FROM nibrun.app_hostnames h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE a.owner_id = ${ownerId}
      ORDER BY h.app_id, h.hostname
    `;
  }

  listByApp({ appId, ownerId }: OwnedApp): Promise<AppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByApp`
      SELECT h.hostname, h.kind, h.state, h.dcv_target
      FROM nibrun.app_hostnames h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE h.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY h.hostname
    `;
  }

  /**
   * Written before the edge is asked for anything, so a row exists to find the custom hostname by
   * if this process dies before the edge answers. The reverse order would leave a hostname at the
   * edge that nothing here names, and nothing to notice it.
   */
  async addCustom({
    appId,
    ownerId,
    hostname,
  }: OwnedApp & { hostname: Hostname }): Promise<AppHostnameRow | null> {
    const [row] = await this.sql.InsertCustomAppHostname`
      INSERT INTO nibrun.app_hostnames (app_id, hostname, kind)
      SELECT a.id, ${hostname}, ${CUSTOM_KIND}
      FROM nibrun.live_apps a
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      RETURNING hostname, kind, state, dcv_target
    `;
    return row ?? null;
  }

  async attachCustom({
    hostname,
    cloudflareId,
    dcvTarget,
  }: {
    hostname: Hostname;
    cloudflareId: string;
    dcvTarget: string | null;
  }): Promise<AppHostnameRow | null> {
    const [row] = await this.sql.UpdateCustomAppHostnameEdge`
      UPDATE nibrun.app_hostnames
      SET cloudflare_id = ${cloudflareId}, dcv_target = ${dcvTarget}
      WHERE hostname = ${hostname} AND kind = ${CUSTOM_KIND}
      RETURNING hostname, kind, state, dcv_target
    `;
    return row ?? null;
  }

  async setCustomState({
    hostname,
    state,
  }: {
    hostname: Hostname;
    state: AppHostnameState;
  }): Promise<boolean> {
    const [row] = await this.sql.UpdateCustomAppHostnameState`
      UPDATE nibrun.app_hostnames
      SET state = ${state}
      WHERE hostname = ${hostname} AND kind = ${CUSTOM_KIND} AND state <> ${state}
      RETURNING hostname
    `;
    return row !== undefined;
  }

  /**
   * By hostname rather than by id: the caller has the name the owner typed, and the name is
   * unique across every app. Guarded on ownership and on kind, so neither another owner's domain
   * nor an app's own platform hostname can be removed through this.
   */
  async removeCustom({
    appId,
    ownerId,
    hostname,
  }: OwnedApp & { hostname: Hostname }): Promise<string | null> {
    const [row] = await this.sql.DeleteCustomAppHostname`
      DELETE FROM nibrun.app_hostnames h
      USING nibrun.live_apps a
      WHERE h.app_id = a.id
        AND h.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND h.hostname = ${hostname} AND h.kind = ${CUSTOM_KIND}
      RETURNING h.cloudflare_id
    `;
    if (!row) {
      return null;
    }
    return row.cloudflare_id ?? null;
  }

  /**
   * Every custom hostname still waiting, whatever app it belongs to and whoever owns it: this
   * feeds the pass that asks the edge what became of them, which answers to nobody's request.
   */
  listPendingCustom({ limit }: { limit: number }): Promise<PendingHostnameRow[]> {
    return this.sql.SelectPendingCustomHostnames`
      SELECT h.hostname, h.cloudflare_id, h.created_at
      FROM nibrun.app_hostnames h
      WHERE h.state = 'pending' AND h.kind = ${CUSTOM_KIND}
      ORDER BY h.id
      LIMIT ${limit}
    `;
  }
}

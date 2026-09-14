import type { AppHostnameKind, AppHostnameState, AppId, Hostname, OwnerId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import type { EdgeReport } from '#repositories/custom-hostnames.repository.ts';
import { Repository, TEXT_ARRAY } from '#repositories/repository.ts';

export type AppHostnameRow = Queries['SelectAppHostnamesByApp'];
export type OwnedAppHostnameRow = Queries['SelectAppHostnamesByOwner'];
export type PendingHostnameRow = Queries['SelectPendingCustomHostnames'];
export type DisposableAppHostnameRow = Queries['SelectDisposableAppHostnames'];

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
  abstract recordEdgeReport(input: { hostname: Hostname; report: EdgeReport }): Promise<boolean>;
  abstract removeCustom(input: OwnedApp & { hostname: Hostname }): Promise<string | null>;
  abstract listPendingCustom(input: {
    after: string | null;
    limit: number;
  }): Promise<PendingHostnameRow[]>;
  abstract listDisposable(input: { appId: AppId }): Promise<DisposableAppHostnameRow[]>;
  abstract removeDisposable(input: { appId: AppId; hostname: Hostname }): Promise<boolean>;
}

export class AppHostnamesRepository extends Repository implements AppHostnamesRepositoryContract {
  listByOwner({ ownerId }: { ownerId: OwnerId }): Promise<OwnedAppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByOwner`
      SELECT h.app_id, h.hostname, h.kind, h.state, h.dcv_target, h.edge_errors
      FROM nibrun.app_hostnames h
      JOIN nibrun.live_apps a ON a.id = h.app_id
      WHERE a.owner_id = ${ownerId}
      ORDER BY h.app_id, h.hostname
    `;
  }

  listByApp({ appId, ownerId }: OwnedApp): Promise<AppHostnameRow[]> {
    return this.sql.SelectAppHostnamesByApp`
      SELECT h.hostname, h.kind, h.state, h.dcv_target, h.edge_errors
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
      RETURNING hostname, kind, state, dcv_target, edge_errors
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
      RETURNING hostname, kind, state, dcv_target, edge_errors
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
   * Whether anything the edge said is new. Guarded on every column rather than written through,
   * so the row's `updated_at` marks the last time the edge said something different — the pass
   * asking is on every host report, and a row rewritten on each would date nothing.
   *
   * Untagged for the reason `insertEnvironment` is: `sql.array` is a clause the generator blanks
   * out before it parses the statement, and `SET edge_errors =` is not a statement. The one
   * column read back is hand-typed instead.
   */
  async recordEdgeReport({
    hostname,
    report,
  }: {
    hostname: Hostname;
    report: EdgeReport;
  }): Promise<boolean> {
    const errors = this.sql.array(report.errors, TEXT_ARRAY);
    const [row] = await this.sql<Array<{ hostname: Hostname }>>`
      UPDATE nibrun.app_hostnames
      SET state = ${report.state},
          edge_status = ${report.status},
          edge_ssl_status = ${report.sslStatus},
          edge_errors = ${errors}
      WHERE hostname = ${hostname} AND kind = ${CUSTOM_KIND}
        AND (state, edge_status, edge_ssl_status, edge_errors) IS DISTINCT FROM
            (${report.state}::text, ${report.status}::text, ${report.sslStatus}::text, ${errors})
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
   * The next batch of custom hostnames still waiting, whatever app they belong to and whoever
   * owns them: this feeds the pass that asks the edge what became of them, which answers to
   * nobody's request.
   *
   * Taken up from `after` rather than from the top, and round to the top once past the end, so
   * a batch's worth of older rows cannot hold the ones behind them out of every pass until they
   * settle. A boolean sorts false before true, which is what puts the rows not yet reached this
   * lap ahead of the ones already asked about; with no cursor every row compares unknown and
   * the order is the plain one.
   */
  listPendingCustom({
    after,
    limit,
  }: {
    after: string | null;
    limit: number;
  }): Promise<PendingHostnameRow[]> {
    return this.sql.SelectPendingCustomHostnames`
      SELECT h.id, h.hostname, h.cloudflare_id, h.created_at
      FROM nibrun.app_hostnames h
      WHERE h.state = 'pending' AND h.kind = ${CUSTOM_KIND}
      ORDER BY h.id <= ${after}::uuid, h.id
      LIMIT ${limit}
    `;
  }

  listDisposable({ appId }: { appId: AppId }): Promise<DisposableAppHostnameRow[]> {
    return this.sql.SelectDisposableAppHostnames`
      SELECT h.hostname, h.kind, h.cloudflare_id
      FROM nibrun.app_hostnames h
      JOIN nibrun.apps a ON a.id = h.app_id
      WHERE h.app_id = ${appId} AND a.state IN ('deleting', 'deleted')
      ORDER BY h.id
    `;
  }

  async removeDisposable({
    appId,
    hostname,
  }: {
    appId: AppId;
    hostname: Hostname;
  }): Promise<boolean> {
    const [removed] = await this.sql.DeleteDisposableAppHostname`
      DELETE FROM nibrun.app_hostnames h
      USING nibrun.apps a
      WHERE h.app_id = a.id
        AND h.app_id = ${appId} AND h.hostname = ${hostname}
        AND a.state IN ('deleting', 'deleted')
      RETURNING h.hostname
    `;
    return removed !== undefined;
  }
}

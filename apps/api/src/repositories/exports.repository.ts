import type { AppId, ExportId, ExportState, OwnerId } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.d.ts';
import { Repository } from '#repositories/repository.ts';

export type ExportRow = Queries['SelectExportById'];

export type RequestExportInput = {
  appId: AppId;
  ownerId: OwnerId;
  expiresAt: Date;
};

export type ExportByIdInput = {
  appId: AppId;
  exportId: ExportId;
  ownerId: OwnerId;
};

export type ExportsByAppInput = {
  appId: AppId;
  ownerId: OwnerId;
};

/** What a host said about a bundle it was asked to write. */
export type ReportedExportRow = {
  exportId: ExportId;
  state: ExportState;
  sizeBytes: number | null;
  readyAt: Date | null;
  message: string | null;
};

export abstract class ExportsRepositoryContract {
  abstract request(input: RequestExportInput): Promise<ExportRow | null>;
  abstract listByApp(input: ExportsByAppInput): Promise<ExportRow[]>;
  abstract findById(input: ExportByIdInput): Promise<ExportRow | null>;
  abstract applyReport(input: { reported: ReportedExportRow[] }): Promise<void>;
  abstract failInFlight(input: { appId: AppId; message: string }): Promise<void>;
}

export class ExportsRepository extends Repository implements ExportsRepositoryContract {
  /**
   * Asking twice while one is still running returns the one already running rather than a second
   * read of the same filesystem. `exports_in_flight_idx` is what decides that, so two requests
   * racing resolve the same way as two arriving a minute apart.
   *
   * The artifact is whichever binary the app most recently had a deployment for — the app's data
   * is what is being exported, and the binary rides along so the bundle can be run. An app that
   * has never been deployed has no binary to send and inserts nothing.
   */
  async request({ appId, ownerId, expiresAt }: RequestExportInput): Promise<ExportRow | null> {
    // INSERT … SELECT rather than VALUES, so the predicate that decides ownership is the one the
    // row is written through rather than one checked beside it.
    const [inserted] = await this.sql.InsertExport`
      INSERT INTO nibrun.exports (app_id, artifact_id, expires_at)
      SELECT a.id, d.artifact_id, ${expiresAt}
      FROM nibrun.live_apps a
      JOIN LATERAL (
        SELECT artifact_id FROM nibrun.deployments d
        WHERE d.app_id = a.id ORDER BY d.id DESC LIMIT 1
      ) d ON true
      WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      ON CONFLICT (app_id) WHERE state IN ('pending', 'preparing') DO NOTHING
      RETURNING id
    `;
    if (inserted) {
      return this.findById({ appId, exportId: inserted.id, ownerId });
    }
    return await this.findInFlight({ appId, ownerId });
  }

  listByApp({ appId, ownerId }: ExportsByAppInput): Promise<ExportRow[]> {
    return this.sql.SelectExportsByApp`
      /* @notNull created_at */
      /* @notNull object_key */
      SELECT e.id, e.app_id, e.state, e.object_key, e.size_bytes, e.message,
             e.ready_at, e.expires_at, e.created_at
      FROM nibrun.exports e
      JOIN nibrun.live_apps a ON a.id = e.app_id
      WHERE e.app_id = ${appId} AND a.owner_id = ${ownerId}
      ORDER BY e.id DESC
    `;
  }

  async findById({ appId, exportId, ownerId }: ExportByIdInput): Promise<ExportRow | null> {
    const [row] = await this.sql.SelectExportById`
      /* @notNull created_at */
      /* @notNull object_key */
      SELECT e.id, e.app_id, e.state, e.object_key, e.size_bytes, e.message,
             e.ready_at, e.expires_at, e.created_at
      FROM nibrun.exports e
      JOIN nibrun.live_apps a ON a.id = e.app_id
      WHERE e.app_id = ${appId} AND e.id = ${exportId} AND a.owner_id = ${ownerId}
    `;
    return row ?? null;
  }

  /**
   * One statement per export rather than one over all of them, as for instances: a host writes a
   * handful, and a batch would have to name the rows it skipped to say anything useful.
   *
   * A row that has already gone terminal is left alone, which is what stops a report assembled
   * before the host was told to forget an export from reopening it.
   */
  applyReport({ reported }: { reported: ReportedExportRow[] }): Promise<void> {
    return this.sql.begin(async (tx) => {
      for (const bundle of reported) {
        await tx.ApplyReportedExport`
          UPDATE nibrun.exports SET
            state = ${bundle.state},
            size_bytes = ${bundle.sizeBytes},
            ready_at = ${bundle.readyAt},
            message = ${bundle.message}
          WHERE id = ${bundle.exportId} AND state IN ('pending', 'preparing')
        `;
      }
    });
  }

  /**
   * No owner in the predicate: the caller has already been answered on whether the app is theirs,
   * and an export the owner cannot reach is one this end has to finish regardless of who asks.
   */
  async failInFlight({ appId, message }: { appId: AppId; message: string }): Promise<void> {
    await this.sql.FailInFlightExports`
      UPDATE nibrun.exports SET state = 'failed', message = ${message}
      WHERE app_id = ${appId} AND state IN ('pending', 'preparing')
    `;
  }

  private async findInFlight({ appId, ownerId }: ExportsByAppInput): Promise<ExportRow | null> {
    const [row] = await this.sql.SelectInFlightExport`
      /* @notNull created_at */
      /* @notNull object_key */
      SELECT e.id, e.app_id, e.state, e.object_key, e.size_bytes, e.message,
             e.ready_at, e.expires_at, e.created_at
      FROM nibrun.exports e
      JOIN nibrun.live_apps a ON a.id = e.app_id
      WHERE e.app_id = ${appId} AND a.owner_id = ${ownerId}
        AND e.state IN ('pending', 'preparing')
    `;
    return row ?? null;
  }
}

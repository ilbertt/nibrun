import type { AppId, Export, ExportId, HostReportedState, OwnerId } from '@repo/protocol';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import { toTimestamp } from '#lib/timestamp.ts';
import type { ExportStorageRepositoryContract } from '#repositories/export-storage.repository.ts';
import type { ExportRow, ExportsRepositoryContract } from '#repositories/exports.repository.ts';
import type { AppOwnership } from '#services/artifacts.service.ts';
import { Service } from '#services/service.ts';

// An app the caller does not own has to be indistinguishable from one that does not exist: a 403
// confirms the app to a stranger.
const NO_SUCH_APP = 'App not found.';
const NO_SUCH_EXPORT = 'Export not found.';
const NOTHING_TO_EXPORT = 'The app has never been deployed, so there is no binary to export.';

const MS_PER_DAY = 86_400_000;

const BUNDLE_SUFFIX = '.tar.gz';

/** What the owner sees, plus the only way to actually reach the bytes. */
export type OwnedExport = Omit<Export, 'objectKey'> & { downloadUrl?: string };

export class ExportsService extends Service {
  private readonly exportsRepo: ExportsRepositoryContract;
  private readonly storageRepo: ExportStorageRepositoryContract;
  private readonly appsRepo: AppOwnership;
  private readonly retentionDays: number;

  constructor({
    exportsRepo,
    storageRepo,
    appsRepo,
    retentionDays,
  }: {
    exportsRepo: ExportsRepositoryContract;
    storageRepo: ExportStorageRepositoryContract;
    appsRepo: AppOwnership;
    retentionDays: number;
  }) {
    super();
    this.exportsRepo = exportsRepo;
    this.storageRepo = storageRepo;
    this.appsRepo = appsRepo;
    this.retentionDays = retentionDays;
  }

  /**
   * Asking again while one is still being written returns that one. Reading a tenant's entire
   * filesystem is the most expensive thing a host does on their behalf, so a second click is
   * answered with the work already in flight rather than with a second copy of it.
   *
   * A finished export is not deduplicated against: asking again once one is ready is asking for
   * data that has moved on since, which is the whole reason to ask twice.
   */
  async request({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<OwnedExport> {
    const expiresAt = new Date(Date.now() + this.retentionDays * MS_PER_DAY);
    const row = await this.exportsRepo.request({ appId, ownerId, expiresAt });
    if (!row) {
      // Two ways to write nothing, and they are not the same answer. Ownership is asked only
      // once the insert has already declined, so the ordinary path costs one statement and a
      // stranger still cannot tell a missing app from one that is not theirs.
      if (await this.appsRepo.isOwnedBy({ appId, ownerId })) {
        throw new ConflictError(NOTHING_TO_EXPORT);
      }
      throw new NotFoundError(NO_SUCH_APP);
    }
    this.logger.info('export requested', { exportId: row.id, appId, state: row.state });
    return this.toOwnedExport(row);
  }

  async list({ appId, ownerId }: { appId: AppId; ownerId: OwnerId }): Promise<OwnedExport[]> {
    const rows = await this.exportsRepo.listByApp({ appId, ownerId });
    return rows.map((row) => this.toOwnedExport(row));
  }

  async get({
    appId,
    exportId,
    ownerId,
  }: {
    appId: AppId;
    exportId: ExportId;
    ownerId: OwnerId;
  }): Promise<OwnedExport> {
    const row = await this.exportsRepo.findById({ appId, exportId, ownerId });
    if (!row) {
      throw new NotFoundError(NO_SUCH_EXPORT);
    }
    return this.toOwnedExport(row);
  }

  /**
   * What the host says about the bundles it was told to write. Only these columns move — the key
   * is not among them, because the host was told it rather than choosing it. The checkpoint is
   * the opposite case and so it is among them: the host named the view it read from, and being
   * told is the only way this end learns which moment the bundle is of.
   */
  async applyHostReport({ reported }: { reported: HostReportedState }): Promise<void> {
    if (reported.exports.length === 0) {
      return;
    }
    await this.exportsRepo.applyReport({
      reported: reported.exports.map((bundle) => ({
        exportId: bundle.exportId,
        checkpointId: bundle.checkpointId ?? null,
        state: bundle.state,
        sizeBytes: bundle.sizeBytes ?? null,
        readyAt: bundle.readyAt ? new Date(bundle.readyAt) : null,
        message: bundle.message ?? null,
      })),
    });
  }

  /**
   * `expired` is read from the deadline rather than stored: the bucket's lifecycle rule is what
   * removes the object, and a column claiming otherwise would be wrong for as long as it took
   * something to notice. A URL is signed only for a bundle that is both written and still there.
   */
  private toOwnedExport(row: ExportRow): OwnedExport {
    const expiresAt = row.expires_at;
    const expired = expiresAt.getTime() <= Date.now();
    const state = expired && row.state !== 'failed' ? 'expired' : row.state;

    return {
      id: row.id,
      appId: row.app_id,
      state,
      checkpointId: row.checkpoint_id ?? undefined,
      sizeBytes: row.size_bytes === null ? undefined : Number(row.size_bytes),
      requestedAt: toTimestamp(row.created_at),
      readyAt: row.ready_at ? toTimestamp(row.ready_at) : undefined,
      expiresAt: toTimestamp(expiresAt),
      downloadUrl:
        state === 'ready'
          ? this.storageRepo.signDownload({
              objectKey: row.object_key,
              filename: `${row.app_slug}${BUNDLE_SUFFIX}`,
            })
          : undefined,
    };
  }
}

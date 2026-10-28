import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import { Repository } from '#repositories/repository.ts';

export type PaidRequestRow = Queries['UpsertPaidRequest'];
export type SavePaidRequestInput = { ownerId: OwnerId; request: PaidRequest };

export abstract class PaidRequestsRepositoryContract {
  abstract save(input: SavePaidRequestInput): Promise<PaidRequestRow | null>;
}

export class PaidRequestsRepository extends Repository implements PaidRequestsRepositoryContract {
  async save({ ownerId, request }: SavePaidRequestInput): Promise<PaidRequestRow | null> {
    const appId = request.requestType === 'apps' ? null : request.appId;
    const [row] = await this.sql.UpsertPaidRequest`
      INSERT INTO nibrun.paid_requests (
        owner_id, request_type, requested_apps_amount, app_id,
        additional_vcpu_count, additional_memory_mib, additional_volume_gib
      )
      SELECT ${ownerId}, ${request.requestType}, ${request.requestType === 'apps' ? request.requestedAppsAmount : null}, ${appId},
        ${request.requestType === 'resources' ? request.additionalVcpuCount : null},
        ${request.requestType === 'resources' ? request.additionalMemoryMib : null},
        ${request.requestType === 'resources' ? request.additionalVolumeGib : null}
      WHERE ${appId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM nibrun.live_apps a WHERE a.id = ${appId} AND a.owner_id = ${ownerId}
      )
      ON CONFLICT (owner_id, request_type, app_id)
      DO UPDATE SET requested_apps_amount = EXCLUDED.requested_apps_amount,
        additional_vcpu_count = EXCLUDED.additional_vcpu_count,
        additional_memory_mib = EXCLUDED.additional_memory_mib,
        additional_volume_gib = EXCLUDED.additional_volume_gib
      WHERE nibrun.paid_requests.owner_id = ${ownerId}
      RETURNING request_type, requested_apps_amount, app_id,
        additional_vcpu_count, additional_memory_mib, additional_volume_gib
    `;
    return row ?? null;
  }
}

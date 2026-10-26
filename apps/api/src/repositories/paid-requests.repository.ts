import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import { Repository } from '#repositories/repository.ts';

export type PaidRequestRow = Queries['UpsertPaidRequest'];
export type SavePaidRequestInput = { ownerId: OwnerId; request: PaidRequest };

export abstract class PaidRequestsRepositoryContract {
  abstract save(input: SavePaidRequestInput): Promise<PaidRequestRow>;
}

export class PaidRequestsRepository extends Repository implements PaidRequestsRepositoryContract {
  async save({ ownerId, request }: SavePaidRequestInput): Promise<PaidRequestRow> {
    const [row] = await this.sql.UpsertPaidRequest`
      INSERT INTO nibrun.paid_requests (owner_id, request_type, requested_apps_amount)
      VALUES (${ownerId}, ${request.requestType}, ${request.requestType === 'apps' ? request.requestedAppsAmount : null})
      ON CONFLICT (owner_id, request_type)
      DO UPDATE SET requested_apps_amount = EXCLUDED.requested_apps_amount
      WHERE nibrun.paid_requests.owner_id = ${ownerId}
      RETURNING request_type, requested_apps_amount
    `;
    if (!row) {
      throw new Error('Saving a paid request returned no row.');
    }
    return row;
  }
}

import type { Queries } from '#db/queries.gen.ts';
import type { OwnerId } from '#lib/api/identifiers.ts';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import { Repository } from '#repositories/repository.ts';

export type PaidRequestRow = Queries['SelectPaidRequests'];
export type PaidRequestsByOwnerInput = { ownerId: OwnerId };
export type SavePaidRequestInput = PaidRequestsByOwnerInput & { request: PaidRequest };

export abstract class PaidRequestsRepositoryContract {
  abstract list(input: PaidRequestsByOwnerInput): Promise<PaidRequestRow[]>;
  abstract save(input: SavePaidRequestInput): Promise<PaidRequestRow>;
}

export class PaidRequestsRepository extends Repository implements PaidRequestsRepositoryContract {
  list({ ownerId }: PaidRequestsByOwnerInput): Promise<PaidRequestRow[]> {
    return this.sql.SelectPaidRequests`
      SELECT request_type, amount FROM nibrun.paid_requests
      WHERE owner_id = ${ownerId}
      ORDER BY request_type
    `;
  }

  async save({ ownerId, request }: SavePaidRequestInput): Promise<PaidRequestRow> {
    const [row] = await this.sql.UpsertPaidRequest`
      INSERT INTO nibrun.paid_requests (owner_id, request_type, amount)
      VALUES (${ownerId}, ${request.requestType}, ${request.amount})
      ON CONFLICT (owner_id, request_type) DO UPDATE SET amount = EXCLUDED.amount
      WHERE nibrun.paid_requests.owner_id = ${ownerId}
      RETURNING request_type, amount
    `;
    if (!row) {
      throw new Error('Saving a paid request returned no row.');
    }
    return row;
  }
}

import { Value } from '@sinclair/typebox/value';
import { type PaidRequest, PaidRequestSchema } from '#lib/api/paid-request.ts';
import type {
  PaidRequestRow,
  PaidRequestsByOwnerInput,
  PaidRequestsRepositoryContract,
  SavePaidRequestInput,
} from '#repositories/paid-requests.repository.ts';
import { Service } from '#services/service.ts';

export class PaidRequestsService extends Service {
  private readonly requestsRepo: PaidRequestsRepositoryContract;

  constructor(input: { requestsRepo: PaidRequestsRepositoryContract }) {
    super();
    this.requestsRepo = input.requestsRepo;
  }

  async list(input: PaidRequestsByOwnerInput): Promise<PaidRequest[]> {
    return (await this.requestsRepo.list(input)).map(paidRequest);
  }

  async save(input: SavePaidRequestInput): Promise<PaidRequest> {
    return paidRequest(await this.requestsRepo.save(input));
  }
}

function paidRequest(row: PaidRequestRow): PaidRequest {
  return Value.Parse(PaidRequestSchema, { requestType: row.request_type, amount: row.amount });
}

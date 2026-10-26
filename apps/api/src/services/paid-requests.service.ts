import { Value } from '@sinclair/typebox/value';
import { type PaidRequest, PaidRequestSchema } from '#lib/api/paid-request.ts';
import type {
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

  async save(input: SavePaidRequestInput): Promise<PaidRequest> {
    const row = await this.requestsRepo.save(input);
    return Value.Parse(PaidRequestSchema, {
      requestType: row.request_type,
      ...(row.request_type === 'apps' ? { requestedAppsAmount: row.requested_apps_amount } : {}),
    });
  }
}

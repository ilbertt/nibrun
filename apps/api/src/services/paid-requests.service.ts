import { Value } from '@sinclair/typebox/value';
import { type PaidRequest, PaidRequestSchema } from '#lib/api/paid-request.ts';
import { NotFoundError } from '#lib/errors.ts';
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
    if (row === null) {
      throw new NotFoundError();
    }
    return Value.Parse(PaidRequestSchema, {
      requestType: row.request_type,
      ...(row.request_type === 'apps'
        ? { requestedAppsAmount: row.requested_apps_amount }
        : { appId: row.app_id }),
      ...(row.request_type === 'resources'
        ? {
            requestedVcpuCount: row.requested_vcpu_count,
            requestedMemoryMib: row.requested_memory_mib,
            requestedVolumeGib: row.requested_volume_gib,
          }
        : {}),
    });
  }
}

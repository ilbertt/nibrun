import { Value } from '@sinclair/typebox/value';
import { type PaidRequest, PaidRequestSchema } from '#lib/api/paid-request.ts';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
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
    const request = input.request;
    if (
      request.requestType === 'resources' &&
      request.additionalVcpuCount === 0 &&
      request.additionalMemoryMib === 0 &&
      request.additionalVolumeGib === 0
    ) {
      throw new BadRequestError('Request an increase for at least one resource.');
    }
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
            additionalVcpuCount: row.additional_vcpu_count,
            additionalMemoryMib: row.additional_memory_mib,
            additionalVolumeGib: row.additional_volume_gib,
          }
        : {}),
    });
  }
}

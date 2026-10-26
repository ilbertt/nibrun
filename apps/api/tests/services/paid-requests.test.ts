import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import type { PaidRequestsRepositoryContract } from '#repositories/paid-requests.repository.ts';
import { PaidRequestsService } from '#services/paid-requests.service.ts';

test.each<PaidRequest>([
  { requestType: 'apps', requestedAppsAmount: 10 },
  { requestType: 'custom-bucket' },
])('saved $requestType requests return only the fields of that request type', async (request) => {
  const ownerId = Value.Parse(OwnerIdSchema, 'request-owner');
  const requestsRepo: PaidRequestsRepositoryContract = {
    save(input) {
      expect(input).toEqual({ ownerId, request });
      return Promise.resolve({
        request_type: request.requestType,
        requested_apps_amount: request.requestType === 'apps' ? request.requestedAppsAmount : null,
      });
    },
  };
  expect(await new PaidRequestsService({ requestsRepo }).save({ ownerId, request })).toEqual(
    request,
  );
});

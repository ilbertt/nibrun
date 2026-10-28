import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';
import type { PaidRequest } from '#lib/api/paid-request.ts';
import { BadRequestError, NotFoundError } from '#lib/errors.ts';
import type { PaidRequestsRepositoryContract } from '#repositories/paid-requests.repository.ts';
import { PaidRequestsService } from '#services/paid-requests.service.ts';
import {
  APP_PAID_REQUESTS,
  paidRequestRow,
  RESOURCES_REQUEST,
} from '#tests/support/paid-requests.ts';

test.each<PaidRequest>([{ requestType: 'apps', requestedAppsAmount: 10 }, ...APP_PAID_REQUESTS])(
  'saved $requestType requests return only the fields of that request type',
  async (request) => {
    const ownerId = Value.Parse(OwnerIdSchema, 'request-owner');
    const requestsRepo: PaidRequestsRepositoryContract = {
      save(input) {
        expect(input).toEqual({ ownerId, request });
        return Promise.resolve(paidRequestRow(request));
      },
    };
    expect(await new PaidRequestsService({ requestsRepo }).save({ ownerId, request })).toEqual(
      request,
    );
  },
);

test('an all-zero resources request is refused before saving', async () => {
  let saves = 0;
  const requestsRepo: PaidRequestsRepositoryContract = {
    save() {
      saves += 1;
      return Promise.resolve(null);
    },
  };
  await expect(
    new PaidRequestsService({ requestsRepo }).save({
      ownerId: Value.Parse(OwnerIdSchema, 'request-owner'),
      request: {
        ...RESOURCES_REQUEST,
        additionalVcpuCount: 0,
        additionalMemoryMib: 0,
        additionalVolumeGib: 0,
      },
    }),
  ).rejects.toBeInstanceOf(BadRequestError);
  expect(saves).toBe(0);
});

test.each(APP_PAID_REQUESTS)(
  'a refused app lookup does not save a $requestType request',
  async (request) => {
    const requestsRepo: PaidRequestsRepositoryContract = {
      save() {
        return Promise.resolve(null);
      },
    };
    await expect(
      new PaidRequestsService({ requestsRepo }).save({
        ownerId: Value.Parse(OwnerIdSchema, 'request-owner'),
        request,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  },
);

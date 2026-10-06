import { describe, expect, test } from 'bun:test';
import { HostIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { BadGatewayError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import type { DeploymentRow } from '#repositories/deployments.repository.ts';
import { CronsService } from '#services/crons.service.ts';
import {
  A_DEPLOYMENT_ROW,
  deploymentLookupRepository,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { CRON_DEPLOYMENT, CRON_LISTING } from '#tests/support/crons.ts';

const HOST_ID = Value.Parse(HostIdSchema, 'host-1');

function service(row: DeploymentRow | null = A_DEPLOYMENT_ROW) {
  const deploymentsRepo = deploymentLookupRepository(row);
  return { deploymentsRepo, crons: new CronsService({ deploymentsRepo }) };
}

function read(crons: CronsService) {
  return crons.list({
    ...CRON_DEPLOYMENT,
    ownerId: OWNER_ID,
    signal: new AbortController().signal,
  });
}

function poll(crons: CronsService) {
  return crons.pendingQuery({
    hostId: HOST_ID,
    servedDeployments: [CRON_DEPLOYMENT],
    signal: new AbortController().signal,
  });
}

function standing(crons: CronsService) {
  return crons.pendingQuery({
    hostId: HOST_ID,
    servedDeployments: [CRON_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
}

describe('authorized realtime cron reads', () => {
  test('returns the host listing unchanged, including suspended registrations', async () => {
    const { crons, deploymentsRepo } = service();
    const host = poll(crons);
    const listing = read(crons);
    const query = await host;
    if (!query) {
      throw new Error('the waiting host must receive the read');
    }
    const suspended = { ...CRON_LISTING, enabled: false };
    crons.acceptResult({
      hostId: HOST_ID,
      queryId: query.queryId,
      outcome: { status: 'listed', listing: suspended },
    });
    expect(await listing).toEqual(suspended);
    expect(deploymentsRepo.asked).toEqual([{ ...CRON_DEPLOYMENT, ownerId: OWNER_ID }]);
  });

  test('a deployment the caller does not own is a 404 before any query is offered', async () => {
    const { crons, deploymentsRepo } = service(null);
    await expect(
      crons.list({
        ...CRON_DEPLOYMENT,
        ownerId: OTHER_OWNER_ID,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(NotFoundError);
    expect(deploymentsRepo.asked).toEqual([{ ...CRON_DEPLOYMENT, ownerId: OTHER_OWNER_ID }]);
    expect(await standing(crons)).toBeUndefined();
  });

  test('a host failure becomes a 502 without exposing its internal message', async () => {
    const { crons } = service();
    const host = poll(crons);
    const listing = read(crons);
    const query = await host;
    if (!query) {
      throw new Error('the waiting host must receive the read');
    }
    crons.acceptResult({
      hostId: HOST_ID,
      queryId: query.queryId,
      outcome: { status: 'failed', message: '/private/agent/crons.json is unreadable' },
    });
    await expect(listing).rejects.toThrow(BadGatewayError);
    await expect(listing).rejects.not.toThrow('/private/agent');
  });

  test('a deadline removes the pending read and returns a 504', async () => {
    const { crons } = service();
    const deadline = new AbortController();
    const listing = crons.list({ ...CRON_DEPLOYMENT, ownerId: OWNER_ID, signal: deadline.signal });
    await Bun.sleep(0);
    deadline.abort();
    await expect(listing).rejects.toThrow(GatewayTimeoutError);
    expect(await standing(crons)).toBeUndefined();
  });
});

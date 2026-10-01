import { describe, expect, test } from 'bun:test';
import { DeploymentIdSchema, HostIdSchema, Value } from '@repo/protocol';
import { PendingCronQueries } from '#lib/cron/pending-queries.ts';
import { CRON_DEPLOYMENT, CRON_LISTING } from '#tests/support/crons.ts';

const HOST_ID = Value.Parse(HostIdSchema, 'host-1');
const OTHER_HOST_ID = Value.Parse(HostIdSchema, 'host-2');
const NEXT_DEPLOYMENT = {
  ...CRON_DEPLOYMENT,
  deploymentId: Value.Parse(DeploymentIdSchema, 'deployment-2'),
};

function claim(pending: PendingCronQueries) {
  return pending.claim({
    hostId: HOST_ID,
    servedDeployments: [CRON_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
}

function open(pending: PendingCronQueries) {
  return pending.open({ ...CRON_DEPLOYMENT, signal: new AbortController().signal });
}

describe('live cron queries', () => {
  test('concurrent readers share a query, including after it is claimed', async () => {
    const pending = new PendingCronQueries();
    const first = open(pending);
    const second = open(pending);
    const query = await claim(pending);
    const third = open(pending);
    expect(query?.queryId).toBe(first.queryId);
    expect(second.queryId).toBe(first.queryId);
    expect(third.queryId).toBe(first.queryId);
    expect(await claim(pending)).toBeUndefined();
    expect(
      pending.answer({
        hostId: HOST_ID,
        queryId: first.queryId,
        outcome: { status: 'listed', listing: CRON_LISTING },
      }),
    ).toBe(true);
    for (const outcome of await Promise.all([first.answered, second.answered, third.answered])) {
      expect(outcome).toEqual({ status: 'listed', listing: CRON_LISTING });
    }
    expect(open(pending).queryId).not.toBe(first.queryId);
  });

  test('an old deployment cannot claim or satisfy the new deployment query', async () => {
    const pending = new PendingCronQueries();
    const read = pending.open({ ...NEXT_DEPLOYMENT, signal: new AbortController().signal });
    expect(await claim(pending)).toBeUndefined();
    expect(
      await pending.claim({
        hostId: HOST_ID,
        servedDeployments: [NEXT_DEPLOYMENT],
        signal: AbortSignal.abort(),
      }),
    ).toMatchObject(NEXT_DEPLOYMENT);
    expect(
      pending.answer({
        hostId: HOST_ID,
        queryId: read.queryId,
        outcome: { status: 'listed', listing: CRON_LISTING },
      }),
    ).toBe(false);
    expect(Bun.peek.status(read.answered)).toBe('pending');
    pending.answer({
      hostId: HOST_ID,
      queryId: read.queryId,
      outcome: { status: 'listed', listing: { ...CRON_LISTING, ...NEXT_DEPLOYMENT } },
    });
    expect((await read.answered).status).toBe('listed');
  });

  test('answers are accepted only from the host that claimed the query', async () => {
    const pending = new PendingCronQueries();
    const read = open(pending);
    const result = {
      queryId: read.queryId,
      outcome: { status: 'listed' as const, listing: CRON_LISTING },
    };
    expect(pending.answer({ ...result, hostId: HOST_ID })).toBe(false);
    await claim(pending);
    expect(pending.answer({ ...result, hostId: OTHER_HOST_ID })).toBe(false);
    expect(pending.answer({ ...result, hostId: HOST_ID })).toBe(true);
    expect(pending.answer({ ...result, hostId: HOST_ID })).toBe(false);
    await read.answered;
  });

  test('opening a read wakes a matching parked host immediately', async () => {
    const pending = new PendingCronQueries();
    const wrongHost = pending.claim({
      hostId: OTHER_HOST_ID,
      servedDeployments: [NEXT_DEPLOYMENT],
      signal: new AbortController().signal,
    });
    const host = pending.claim({
      hostId: HOST_ID,
      servedDeployments: [CRON_DEPLOYMENT],
      signal: new AbortController().signal,
    });
    const read = open(pending);
    expect(await host).toMatchObject({ ...CRON_DEPLOYMENT, queryId: read.queryId });
    expect(Bun.peek.status(wrongHost)).toBe('pending');
    expect(await claim(pending)).toBeUndefined();
  });

  test('a disconnected host takes no later query', async () => {
    const pending = new PendingCronQueries();
    const disconnected = new AbortController();
    const host = pending.claim({
      hostId: OTHER_HOST_ID,
      servedDeployments: [CRON_DEPLOYMENT],
      signal: disconnected.signal,
    });
    disconnected.abort();
    expect(await host).toBeUndefined();
    const read = open(pending);
    expect(await claim(pending)).toMatchObject({ queryId: read.queryId });
  });

  test('one disconnected reader leaves others waiting; the last removes the query', async () => {
    const pending = new PendingCronQueries();
    const first = new AbortController();
    const second = new AbortController();
    const read = pending.open({ ...CRON_DEPLOYMENT, signal: first.signal });
    const joined = pending.open({ ...CRON_DEPLOYMENT, signal: second.signal });
    const rejected = Promise.allSettled([read.answered, joined.answered]);
    first.abort();
    expect(Bun.peek.status(joined.answered)).toBe('pending');
    second.abort();
    expect((await rejected).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(await claim(pending)).toBeUndefined();
    expect(
      pending.answer({
        hostId: HOST_ID,
        queryId: read.queryId,
        outcome: { status: 'failed', message: 'unavailable' },
      }),
    ).toBe(false);
  });

  test('an already disconnected reader creates no standing query', async () => {
    const pending = new PendingCronQueries();
    const read = pending.open({ ...CRON_DEPLOYMENT, signal: AbortSignal.abort() });
    await expect(read.answered).rejects.toThrow();
    expect(await claim(pending)).toBeUndefined();
  });
});

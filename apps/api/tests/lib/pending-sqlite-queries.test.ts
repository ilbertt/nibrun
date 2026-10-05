import { describe, expect, test } from 'bun:test';
import { DeploymentIdSchema, type HostId, Value } from '@repo/protocol';
import { PendingSqliteQueries } from '#lib/sqlite/pending-queries.ts';
import {
  SQLITE_DEPLOYMENT,
  SQLITE_HOST_ID,
  SQLITE_OTHER_HOST_ID,
  SQLITE_SESSION_ID,
  SQLITE_STATEMENT,
} from '#tests/support/sqlite.ts';

function open(pending: PendingSqliteQueries) {
  return pending.open({
    ...SQLITE_DEPLOYMENT,
    sessionId: SQLITE_SESSION_ID,
    operation: { type: 'execute', statement: SQLITE_STATEMENT },
    targetHostId: undefined,
    signal: new AbortController().signal,
  });
}
function claim({ pending, hostId }: { pending: PendingSqliteQueries; hostId: HostId }) {
  return pending.claim({
    hostId,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
}

describe('live SQLite exchanges', function suite() {
  test('identical SQL requests are executed separately and never reissued', async function independent() {
    const pending = new PendingSqliteQueries();
    const first = open(pending);
    const second = open(pending);
    expect(first.queryId).not.toBe(second.queryId);
    expect((await claim({ pending, hostId: SQLITE_HOST_ID }))?.queryId).toBe(first.queryId);
    expect((await claim({ pending, hostId: SQLITE_HOST_ID }))?.queryId).toBe(second.queryId);
    expect(await claim({ pending, hostId: SQLITE_HOST_ID })).toBeUndefined();
    for (const read of [first, second]) {
      pending.answer({
        hostId: SQLITE_HOST_ID,
        queryId: read.queryId,
        outcome: { status: 'closed' },
      });
      await read.answered;
    }
  });
  test('only the claiming host may answer and only once', async function hostBound() {
    const pending = new PendingSqliteQueries();
    const read = open(pending);
    const result = { queryId: read.queryId, outcome: { status: 'opened' as const } };
    expect(pending.answer({ ...result, hostId: SQLITE_HOST_ID })).toBe(false);
    await claim({ pending, hostId: SQLITE_HOST_ID });
    expect(pending.answer({ ...result, hostId: SQLITE_OTHER_HOST_ID })).toBe(false);
    expect(pending.answer({ ...result, hostId: SQLITE_HOST_ID })).toBe(true);
    expect(pending.answer({ ...result, hostId: SQLITE_HOST_ID })).toBe(false);
    expect(await read.answered).toEqual({ outcome: { status: 'opened' }, hostId: SQLITE_HOST_ID });
  });
  test('a session stays on its selected host and deployment', async function affinity() {
    const pending = new PendingSqliteQueries();
    const read = pending.open({
      ...SQLITE_DEPLOYMENT,
      sessionId: SQLITE_SESSION_ID,
      operation: { type: 'close' },
      targetHostId: SQLITE_HOST_ID,
      signal: new AbortController().signal,
    });
    expect(await claim({ pending, hostId: SQLITE_OTHER_HOST_ID })).toBeUndefined();
    expect(
      await pending.claim({
        hostId: SQLITE_HOST_ID,
        servedDeployments: [
          {
            ...SQLITE_DEPLOYMENT,
            deploymentId: Value.Parse(DeploymentIdSchema, 'deployment-2'),
          },
        ],
        signal: AbortSignal.abort(),
      }),
    ).toBeUndefined();
    expect((await claim({ pending, hostId: SQLITE_HOST_ID }))?.queryId).toBe(read.queryId);
    pending.answer({
      hostId: SQLITE_HOST_ID,
      queryId: read.queryId,
      outcome: { status: 'closed' },
    });
    await read.answered;
  });
  test('cancelled queries are removed and late answers ignored', async function cancellation() {
    const pending = new PendingSqliteQueries();
    const abort = new AbortController();
    const read = pending.open({
      ...SQLITE_DEPLOYMENT,
      sessionId: SQLITE_SESSION_ID,
      operation: {
        type: 'open',
        path: Value.Parse((await import('@repo/protocol')).GuestPathSchema, '/app.db'),
      },
      targetHostId: undefined,
      signal: abort.signal,
    });
    const rejected = read.answered.catch(function caught(error) {
      return error;
    });
    await claim({ pending, hostId: SQLITE_HOST_ID });
    abort.abort();
    expect(await rejected).toBeDefined();
    expect(await claim({ pending, hostId: SQLITE_HOST_ID })).toBeUndefined();
    expect(
      pending.answer({
        hostId: SQLITE_HOST_ID,
        queryId: read.queryId,
        outcome: { status: 'opened' },
      }),
    ).toBe(false);
  });
  test('a matching parked host receives new queries immediately', async function parked() {
    const pending = new PendingSqliteQueries();
    const abort = new AbortController();
    const offered = pending.claim({
      hostId: SQLITE_HOST_ID,
      servedDeployments: [SQLITE_DEPLOYMENT],
      signal: abort.signal,
    });
    const read = open(pending);
    expect((await offered)?.queryId).toBe(read.queryId);
    pending.answer({
      hostId: SQLITE_HOST_ID,
      queryId: read.queryId,
      outcome: { status: 'closed' },
    });
    await read.answered;
    abort.abort();
  });
});

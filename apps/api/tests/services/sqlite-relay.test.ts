import { expect, test } from 'bun:test';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import { SQLITE_DEPLOYMENT, SQLITE_HOST_ID, SQLITE_SESSION_ID } from '#tests/support/sqlite.ts';

test('a SQLite exchange returns its outcome and the host needed by subsequent stream requests', async function exchange() {
  const relay = new SqliteRelayService();
  const result = relay.execute({
    ...SQLITE_DEPLOYMENT,
    sessionId: SQLITE_SESSION_ID,
    operation: { type: 'close' },
    targetHostId: undefined,
    signal: new AbortController().signal,
  });
  const query = await relay.pendingQuery({
    hostId: SQLITE_HOST_ID,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
  if (!query) {
    throw new Error('the SQLite operation must be offered');
  }
  relay.acceptResult({
    queryId: query.queryId,
    hostId: SQLITE_HOST_ID,
    outcome: { status: 'closed' },
  });
  expect(await result).toEqual({ outcome: { status: 'closed' }, hostId: SQLITE_HOST_ID });
});

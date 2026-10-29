import { expect, test } from 'bun:test';
import { ConflictError } from '#lib/errors.ts';
import { SqliteRelayService } from '#services/sqlite-relay.service.ts';
import { deploymentHostsRepository } from '#tests/support/deployment-hosts.ts';
import {
  SQLITE_DEPLOYMENT,
  SQLITE_HOST_ID,
  SQLITE_OTHER_HOST_ID,
  SQLITE_SESSION_ID,
} from '#tests/support/sqlite.ts';

test('a SQLite exchange returns its outcome and the host needed by subsequent stream requests', async function exchange() {
  const relay = new SqliteRelayService({
    deploymentHostsRepo: deploymentHostsRepository({
      hostId: SQLITE_HOST_ID,
      deploymentId: SQLITE_DEPLOYMENT.deploymentId,
    }),
  });
  const result = relay.execute({
    ...SQLITE_DEPLOYMENT,
    sessionId: SQLITE_SESSION_ID,
    operation: { type: 'close' },
    targetHostId: undefined,
    signal: new AbortController().signal,
  });
  await Bun.sleep(0);
  expect(
    await relay.pendingQuery({
      hostId: SQLITE_OTHER_HOST_ID,
      servedDeployments: [SQLITE_DEPLOYMENT],
      signal: AbortSignal.abort(),
    }),
  ).toBeUndefined();
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

test('an unassigned execution cannot enter the SQLite queue', async () => {
  const relay = new SqliteRelayService({
    deploymentHostsRepo: deploymentHostsRepository({
      hostId: undefined,
      deploymentId: SQLITE_DEPLOYMENT.deploymentId,
    }),
  });
  await expect(
    relay.execute({
      ...SQLITE_DEPLOYMENT,
      sessionId: SQLITE_SESSION_ID,
      operation: { type: 'close' },
      targetHostId: undefined,
      signal: new AbortController().signal,
    }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(
    await relay.pendingQuery({
      hostId: SQLITE_HOST_ID,
      servedDeployments: [SQLITE_DEPLOYMENT],
      signal: AbortSignal.abort(),
    }),
  ).toBeUndefined();
});

test('an existing SQLite session closes on its pinned host after placement changes', async () => {
  const relay = new SqliteRelayService({
    deploymentHostsRepo: deploymentHostsRepository({
      hostId: undefined,
      deploymentId: SQLITE_DEPLOYMENT.deploymentId,
    }),
  });
  const closing = relay.execute({
    ...SQLITE_DEPLOYMENT,
    sessionId: SQLITE_SESSION_ID,
    operation: { type: 'close' },
    targetHostId: SQLITE_HOST_ID,
    signal: new AbortController().signal,
  });
  const query = await relay.pendingQuery({
    hostId: SQLITE_HOST_ID,
    servedDeployments: [SQLITE_DEPLOYMENT],
    signal: AbortSignal.abort(),
  });
  expect(query).toBeDefined();
  relay.acceptResult({
    hostId: SQLITE_HOST_ID,
    queryId: query!.queryId,
    outcome: { status: 'closed' },
  });
  expect((await closing).hostId).toBe(SQLITE_HOST_ID);
});

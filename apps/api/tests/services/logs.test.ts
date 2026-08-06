import { describe, expect, test } from 'bun:test';
import type { TenantLogRecord } from '@repo/protocol';
import { NotFoundError } from '#lib/errors.ts';
import type { DeploymentByIdInput, DeploymentRow } from '#repositories/deployments.repository.ts';
import type { LogsRepositoryContract, TenantLogTail } from '#repositories/logs.repository.ts';
import { type DeploymentLookup, LogsService } from '#services/logs.service.ts';
import {
  APP_ID,
  DEPLOYMENT_ID,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';

const START_OFFSET = '5m';
const OPEN_TIMEOUT_MS = 1_000;

const OWNED: DeploymentByIdInput = {
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
  ownerId: OWNER_ID,
};

/** What the store hands back is the repository's business; this service only decides who may ask. */
const NO_RECORDS: AsyncIterable<TenantLogRecord> = {
  [Symbol.asyncIterator]() {
    return { next: () => Promise.resolve({ done: true, value: undefined }) };
  },
};

// The row's contents are never read — only whether there was one — so this is the whole of what
// the service asks Postgres for.
const A_ROW = {} as DeploymentRow;

function deployments(
  row: DeploymentRow | null,
): DeploymentLookup & { asked: DeploymentByIdInput[] } {
  const asked: DeploymentByIdInput[] = [];
  return {
    asked,
    findById(input) {
      asked.push(input);
      return Promise.resolve(row);
    },
  };
}

function logs(): LogsRepositoryContract & { asked: TenantLogTail[] } {
  const asked: TenantLogTail[] = [];
  return {
    asked,
    tail(input) {
      asked.push(input);
      return NO_RECORDS;
    },
  };
}

function service({ row }: { row: DeploymentRow | null }) {
  const deploymentsRepo = deployments(row);
  const logsRepo = logs();
  return {
    logsRepo,
    deploymentsRepo,
    logsService: new LogsService({ logsRepo, deploymentsRepo }),
  };
}

function open({
  subject,
  ownerId = OWNER_ID,
}: {
  subject: ReturnType<typeof service>;
  ownerId?: typeof OWNER_ID;
}) {
  return subject.logsService.openTail({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    ownerId,
    startOffset: START_OFFSET,
    signal: AbortSignal.timeout(OPEN_TIMEOUT_MS),
  });
}

describe('reading a deployment logs is asking whether you own it', () => {
  test('an owned deployment opens a tail filtered to itself', async () => {
    const subject = service({ row: A_ROW });

    await open({ subject });

    expect(subject.deploymentsRepo.asked).toEqual([OWNED]);
    expect(subject.logsRepo.asked[0]).toMatchObject({
      appId: APP_ID,
      deploymentId: DEPLOYMENT_ID,
      startOffset: START_OFFSET,
    });
  });

  // A deployment the caller cannot see must not be confirmed to exist, so the store is never
  // reached — not merely filtered on the way out.
  test('a deployment the caller does not own is a 404 the store never hears about', async () => {
    const subject = service({ row: null });

    await expect(open({ subject, ownerId: OTHER_OWNER_ID })).rejects.toThrow(NotFoundError);
    expect(subject.logsRepo.asked).toHaveLength(0);
  });

  // Scoped in the query rather than compared afterwards, like every other read of a tenant row.
  test('ownership travels into the lookup', async () => {
    const subject = service({ row: A_ROW });

    await open({ subject });

    expect(subject.deploymentsRepo.asked[0]?.ownerId).toBe(OWNER_ID);
  });
});

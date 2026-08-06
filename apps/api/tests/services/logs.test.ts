import { describe, expect, test } from 'bun:test';
import {
  HostIdSchema,
  type TenantLogRecord,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { NotFoundError } from '#lib/errors.ts';
import type { DeploymentByIdInput, DeploymentRow } from '#repositories/deployments.repository.ts';
import type { LogsRepositoryContract, TenantLogWindow } from '#repositories/logs.repository.ts';
import { LogsService } from '#services/logs.service.ts';
import {
  A_DEPLOYMENT_ROW,
  APP_ID,
  DEPLOYMENT_ID,
  deploymentLookup,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';

const TIMERANGE = '5m';
const TIMERANGE_MS = 300_000;
const GIVE_UP_MS = 50;

/** Long enough to outlast the service's own pause between two reads, and no longer. */
const PAST_ONE_PAUSE_MS = 1_200;
const AN_INSTANT = Value.Parse(TimestampSchema, '2026-08-06T09:41:00.123Z');
const A_LATER_INSTANT = Value.Parse(TimestampSchema, '2026-08-06T09:41:02.456Z');

const OWNED: DeploymentByIdInput = {
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
  ownerId: OWNER_ID,
};

function record({ at, sequence }: { at: Timestamp; sequence: number }): TenantLogRecord {
  return {
    _time: at,
    _msg: `line ${sequence}`,
    hostId: Value.Parse(HostIdSchema, 'host-1'),
    SOURCE: 'tenant',
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    stream: 'stdout',
    sourceId: 'source-1',
    sequence,
  };
}

/** One answer per read, so a test says what the store had when the loop came back round. */
function logs(pages: TenantLogRecord[][]): LogsRepositoryContract & { asked: TenantLogWindow[] } {
  const asked: TenantLogWindow[] = [];
  return {
    asked,
    read(input) {
      asked.push(input);
      return Promise.resolve(pages[asked.length - 1] ?? []);
    },
  };
}

function service({ row, pages = [] }: { row: DeploymentRow | null; pages?: TenantLogRecord[][] }) {
  const deploymentsRepo = deploymentLookup(row);
  const logsRepo = logs(pages);
  return {
    logsRepo,
    deploymentsRepo,
    logsService: new LogsService({ logsRepo, deploymentsRepo }),
  };
}

function poll({
  subject,
  ownerId = OWNER_ID,
  since,
  giveUpMs = GIVE_UP_MS,
}: {
  subject: ReturnType<typeof service>;
  ownerId?: typeof OWNER_ID;
  since?: Timestamp;
  giveUpMs?: number;
}) {
  return subject.logsService.poll({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    ownerId,
    since,
    timerange: TIMERANGE,
    signal: AbortSignal.timeout(giveUpMs),
  });
}

describe('reading a deployment logs is asking whether you own it', () => {
  test('an owned deployment reads a window filtered to itself', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      pages: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });

    await poll({ subject });

    expect(subject.deploymentsRepo.asked).toEqual([OWNED]);
    expect(subject.logsRepo.asked[0]).toMatchObject({
      appId: APP_ID,
      deploymentId: DEPLOYMENT_ID,
    });
  });

  // A deployment the caller cannot see must not be confirmed to exist, so the store is never
  // reached — not merely filtered on the way out.
  test('a deployment the caller does not own is a 404 the store never hears about', async () => {
    const subject = service({ row: null });

    await expect(poll({ subject, ownerId: OTHER_OWNER_ID })).rejects.toThrow(NotFoundError);
    expect(subject.logsRepo.asked).toHaveLength(0);
  });

  // Scoped in the query rather than compared afterwards, like every other read of a tenant row.
  test('ownership travels into the lookup', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    await poll({ subject });

    expect(subject.deploymentsRepo.asked[0]?.ownerId).toBe(OWNER_ID);
  });
});

describe('a page is waited for rather than answered empty', () => {
  test('a first read starts a timerange ago', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      pages: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });
    const before = Date.now();

    await poll({ subject });

    const since = Date.parse(subject.logsRepo.asked[0]?.since ?? '');
    expect(since).toBeGreaterThanOrEqual(before - TIMERANGE_MS);
    expect(since).toBeLessThanOrEqual(Date.now() - TIMERANGE_MS);
  });

  test('a cursor is resumed from rather than the timerange', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      pages: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });

    await poll({ subject, since: AN_INSTANT });

    expect(subject.logsRepo.asked[0]?.since).toBe(AN_INSTANT);
  });

  // Asking again is the whole of what the request is doing while the app is quiet.
  test('nothing yet is looked for again rather than returned', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      pages: [[], [record({ at: AN_INSTANT, sequence: 0 })]],
    });

    const page = await poll({ subject, giveUpMs: PAST_ONE_PAUSE_MS });

    expect(subject.logsRepo.asked.length).toBeGreaterThan(1);
    expect(page.records).toHaveLength(1);
  });

  // The ceiling above this reaches on every quiet follow, so it is an answer and not a failure.
  test('a wait that runs out answers with the cursor it was given', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    const page = await poll({ subject, since: AN_INSTANT });

    expect(page).toEqual({ records: [], cursor: AN_INSTANT });
  });

  // A log quiet enough to outlast several pauses is the ordinary case, and each pause listens to
  // the same signal — which is the arrangement that would otherwise leave this waiting forever.
  test('a log that stays quiet still ends when the signal does', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    const page = await poll({ subject, since: AN_INSTANT, giveUpMs: PAST_ONE_PAUSE_MS });

    expect(page.records).toHaveLength(0);
    expect(subject.logsRepo.asked.length).toBeGreaterThan(1);
  });

  /**
   * Inclusive of the record it names: the store stamps to the millisecond, so a record sharing
   * the last one's instant may not have been written when this page was read.
   */
  test('the cursor is the instant the page reached', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      pages: [
        [record({ at: AN_INSTANT, sequence: 0 }), record({ at: A_LATER_INSTANT, sequence: 1 })],
      ],
    });

    expect((await poll({ subject })).cursor).toBe(A_LATER_INSTANT);
  });
});

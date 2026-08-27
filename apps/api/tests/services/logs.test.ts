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

/** Longer than this suite would ever wait, so a read that ends did so on its own. */
const NEVER_MS = 300_000;

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

/** One answer per read, so a test says what the store held when the loop came back round. */
function logs(windows: TenantLogRecord[][]): LogsRepositoryContract & { asked: TenantLogWindow[] } {
  const asked: TenantLogWindow[] = [];
  return {
    asked,
    read(input) {
      asked.push(input);
      return Promise.resolve(windows[asked.length - 1] ?? []);
    },
  };
}

function service({
  row,
  windows = [],
}: {
  row: DeploymentRow | null;
  windows?: TenantLogRecord[][];
}) {
  const deploymentsRepo = deploymentLookup(row);
  const logsRepo = logs(windows);
  return {
    logsRepo,
    deploymentsRepo,
    logsService: new LogsService({ logsRepo, deploymentsRepo }),
  };
}

function open({
  subject,
  ownerId = OWNER_ID,
  giveUpMs = GIVE_UP_MS,
  follow = true,
}: {
  subject: ReturnType<typeof service>;
  ownerId?: typeof OWNER_ID;
  giveUpMs?: number;
  follow?: boolean;
}) {
  return subject.logsService.openStream({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    ownerId,
    timerange: TIMERANGE,
    follow,
    signal: AbortSignal.timeout(giveUpMs),
  });
}

async function drain(records: AsyncIterable<TenantLogRecord>): Promise<TenantLogRecord[]> {
  const seen: TenantLogRecord[] = [];
  for await (const record of records) {
    seen.push(record);
  }
  return seen;
}

describe('reading a deployment logs is asking whether you own it', () => {
  test('an owned deployment opens a stream filtered to itself', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    await drain(await open({ subject }));

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

    await expect(open({ subject, ownerId: OTHER_OWNER_ID })).rejects.toThrow(NotFoundError);
    expect(subject.logsRepo.asked).toHaveLength(0);
  });

  // Scoped in the query rather than compared afterwards, like every other read of a tenant row.
  test('ownership travels into the lookup', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    await drain(await open({ subject }));

    expect(subject.deploymentsRepo.asked[0]?.ownerId).toBe(OWNER_ID);
  });
});

/**
 * A reader with nothing to wait for. An app that is not running writes nothing more, so a stream
 * held open on one is a terminal that never comes back — and the history is still worth having.
 */
describe('a read that is not following ends where the store does', () => {
  test('what the store holds is handed over, and that is the end of it', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });

    const seen = await drain(await open({ subject, follow: false, giveUpMs: NEVER_MS }));

    expect(seen).toHaveLength(1);
    expect(subject.logsRepo.asked).toHaveLength(1);
  });

  // The signal is what ends a follow, so a read that ends on its own is the one thing that proves
  // this is not one: nothing here is waiting for it.
  test('and it ends without waiting on anything to stop it', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    expect(await drain(await open({ subject, follow: false, giveUpMs: NEVER_MS }))).toHaveLength(0);
  });
});

describe('a stream is windows of the store, and reads as one log', () => {
  test('the first window starts a timerange ago', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });
    const before = Date.now();

    await drain(await open({ subject }));

    const since = Date.parse(subject.logsRepo.asked[0]?.since ?? '');
    expect(since).toBeGreaterThanOrEqual(before - TIMERANGE_MS);
    expect(since).toBeLessThanOrEqual(Date.now() - TIMERANGE_MS);
  });

  test('records are handed over as they are found', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });

    expect(await drain(await open({ subject }))).toHaveLength(1);
  });

  // Asking again is the whole of what a stream does while the app is quiet.
  test('nothing yet is looked for again rather than ending the stream', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [[], [record({ at: AN_INSTANT, sequence: 0 })]],
    });

    const seen = await drain(await open({ subject, giveUpMs: PAST_ONE_PAUSE_MS }));

    expect(subject.logsRepo.asked.length).toBeGreaterThan(1);
    expect(seen).toHaveLength(1);
  });

  // A log quiet enough to outlast several pauses is the ordinary case, and each pause listens to
  // the same signal — which is the arrangement that would otherwise leave this running forever.
  test('a log that stays quiet still ends when the signal does', async () => {
    const subject = service({ row: A_DEPLOYMENT_ROW });

    const seen = await drain(await open({ subject, giveUpMs: PAST_ONE_PAUSE_MS }));

    expect(seen).toHaveLength(0);
    expect(subject.logsRepo.asked.length).toBeGreaterThan(1);
  });

  /**
   * A window starts on the instant the last one ended, so it carries that instant's records again.
   * That the stream is assembled from windows is the service's business, so the repeat stops here.
   */
  test('the overlap between two windows is handed over once', async () => {
    const repeated = record({ at: A_LATER_INSTANT, sequence: 1 });
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [
        [record({ at: AN_INSTANT, sequence: 0 }), repeated],
        [repeated, record({ at: A_LATER_INSTANT, sequence: 2 })],
      ],
    });

    const seen = await drain(await open({ subject, giveUpMs: PAST_ONE_PAUSE_MS }));

    expect(seen.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
  });

  /**
   * A guest writes several lines within one millisecond every time it announces itself, and only
   * the overlap between windows is a repeat — sharing an instant with the record before it is not.
   */
  test('a burst written inside one millisecond is handed over whole', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [
        [
          record({ at: AN_INSTANT, sequence: 0 }),
          record({ at: AN_INSTANT, sequence: 1 }),
          record({ at: AN_INSTANT, sequence: 2 }),
        ],
      ],
    });

    const seen = await drain(await open({ subject }));

    expect(seen.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
  });

  test('the next window starts where the last one reached', async () => {
    const subject = service({
      row: A_DEPLOYMENT_ROW,
      windows: [[record({ at: AN_INSTANT, sequence: 0 })]],
    });

    await drain(await open({ subject, giveUpMs: PAST_ONE_PAUSE_MS }));

    expect(subject.logsRepo.asked[1]?.since).toBe(AN_INSTANT);
  });
});

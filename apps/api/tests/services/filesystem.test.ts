import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  type DirectoryListing,
  type FilesystemQuery,
  GUEST_PATH_ROOT,
  type GuestPath,
  GuestPathSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { BadGatewayError, GatewayTimeoutError, NotFoundError } from '#lib/errors.ts';
import type { DeploymentRow } from '#repositories/deployments.repository.ts';
import { FilesystemService } from '#services/filesystem.service.ts';
import {
  A_DEPLOYMENT_ROW,
  APP_ID,
  DEPLOYMENT_ID,
  deploymentLookup,
  OTHER_OWNER_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';

const OTHER_APP = Value.Parse(AppIdSchema, 'app-somebody-else');
const DATA = Value.Parse(GuestPathSchema, '/pb_data');

// Long enough to be a hold and short enough that a test waits it out rather than the clock.
const A_BRIEF_HOLD_MS = 20;

const UNREADABLE_DEVICE = 'no directory could be read from /dev/nbd7';

const LISTING: DirectoryListing = {
  path: DATA,
  entries: [
    {
      name: 'data.db',
      kind: 'file',
      sizeBytes: 4096,
      modifiedAt: Value.Parse(TimestampSchema, '2026-08-03T09:41:00Z'),
    },
  ],
  truncated: false,
};

function service({ row = A_DEPLOYMENT_ROW }: { row?: DeploymentRow | null } = {}) {
  const deploymentsRepo = deploymentLookup(row);
  return { deploymentsRepo, filesystemService: new FilesystemService({ deploymentsRepo }) };
}

/**
 * The signal is a controller nothing fires rather than a deadline, so a read that no test
 * finishes simply stays waiting — the way the request holding it would. A test asserting on a
 * timeout would be asserting on the clock.
 */
function read({
  filesystemService,
  path = DATA,
  ownerId = OWNER_ID,
  signal = new AbortController().signal,
}: {
  filesystemService: FilesystemService;
  path?: GuestPath;
  ownerId?: typeof OWNER_ID;
  signal?: AbortSignal;
}) {
  return filesystemService.readDirectory({
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    ownerId,
    path,
    signal,
  });
}

/**
 * What a host polling now would be handed without waiting for more. An already-aborted signal is a
 * host that is no longer holding its poll open, which is the only way to ask what is standing
 * without becoming the one it would be handed to.
 */
function handedTo({
  filesystemService,
  servedAppIds = [APP_ID],
}: {
  filesystemService: FilesystemService;
  servedAppIds?: readonly AppId[];
}) {
  return filesystemService.pendingQuery({ servedAppIds, signal: AbortSignal.abort() });
}

/**
 * A host holding its poll open, as a request the api has not answered yet is. Nothing fires the
 * signal unless a test does, so a host no test sends away waits the way a real one would.
 */
function polling({
  filesystemService,
  servedAppIds = [APP_ID],
  signal = new AbortController().signal,
}: {
  filesystemService: FilesystemService;
  servedAppIds?: readonly AppId[];
  signal?: AbortSignal;
}) {
  return filesystemService.pendingQuery({ servedAppIds, signal });
}

/** The ownership lookup is awaited first, because a read is only offered once somebody waits on it. */
async function offered(filesystemService: FilesystemService) {
  await Bun.sleep(0);
  return handedTo({ filesystemService });
}

async function claimed(filesystemService: FilesystemService): Promise<FilesystemQuery> {
  const query = await offered(filesystemService);
  if (!query) {
    throw new Error('a read somebody is waiting on has to be offered to a host that serves it');
  }
  return query;
}

describe('a read waits for the host that holds the volume', () => {
  test('nothing is offered to a host until somebody asks for something', async () => {
    const { filesystemService } = service();

    expect(await offered(filesystemService)).toBeUndefined();
  });

  test("what the host reads is what the caller gets back, at the caller's path", async () => {
    const { filesystemService } = service();
    const listing = read({ filesystemService });
    const query = await claimed(filesystemService);

    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });

    expect(query).toMatchObject({ appId: APP_ID, path: DATA });
    expect(await listing).toEqual(LISTING);
  });

  // Two people browsing at once are two reads, and only the one whose id came back is finished.
  test('an answer finishes the request that asked for it and no other', async () => {
    const { filesystemService } = service();
    const first = read({ filesystemService, path: GUEST_PATH_ROOT });
    const firstQuery = await claimed(filesystemService);
    const second = read({ filesystemService, path: DATA });
    const secondQuery = await claimed(filesystemService);

    filesystemService.acceptResult({
      queryId: secondQuery.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });

    expect(firstQuery.path).toBe(GUEST_PATH_ROOT);
    expect(await second).toEqual(LISTING);
    expect(Bun.peek.status(first)).toBe('pending');
  });

  // Without this the first host to poll would take every tenant's read and fail all but its own.
  test('a host that does not serve the app is given nothing', async () => {
    const { filesystemService } = service();
    void read({ filesystemService });
    await Bun.sleep(0);

    expect(await handedTo({ filesystemService, servedAppIds: [OTHER_APP] })).toBeUndefined();
    expect(await handedTo({ filesystemService, servedAppIds: [] })).toBeUndefined();
  });

  // A second host taking it would read a filesystem for a request another host is already
  // finishing, and only one answer per id can arrive.
  test('a read already handed out is not handed out again', async () => {
    const { filesystemService } = service();
    void read({ filesystemService });
    await claimed(filesystemService);

    expect(await handedTo({ filesystemService })).toBeUndefined();
  });
});

describe('people looking at the same directory wait on one read', () => {
  test('a second caller asking for it adds no second read', async () => {
    const { filesystemService } = service();
    void read({ filesystemService, path: DATA });
    void read({ filesystemService, path: DATA });
    await claimed(filesystemService);

    expect(await handedTo({ filesystemService })).toBeUndefined();
  });

  test('and both are answered by the one listing that comes back', async () => {
    const { filesystemService } = service();
    const first = read({ filesystemService, path: DATA });
    const second = read({ filesystemService, path: DATA });
    const query = await claimed(filesystemService);

    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });

    expect(await first).toEqual(LISTING);
    expect(await second).toEqual(LISTING);
  });

  // Where most of the saving is: the host is reading that exact directory right now, so the
  // answer to wait for already exists rather than being a reason to ask for a second read.
  test('a caller arriving after a host took the read joins it rather than queueing behind it', async () => {
    const { filesystemService } = service();
    void read({ filesystemService, path: DATA });
    const query = await claimed(filesystemService);
    const late = read({ filesystemService, path: DATA });

    expect(await offered(filesystemService)).toBeUndefined();
    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });
    expect(await late).toEqual(LISTING);
  });

  test('a different directory is still its own read', async () => {
    const { filesystemService } = service();
    void read({ filesystemService, path: DATA });
    const first = await claimed(filesystemService);
    void read({ filesystemService, path: GUEST_PATH_ROOT });
    const second = await claimed(filesystemService);

    expect(first.path).toBe(DATA);
    expect(second.path).toBe(GUEST_PATH_ROOT);
  });

  // A read outlives any one of its callers and none of them all.
  test('one caller giving up leaves the read standing for the others', async () => {
    const { filesystemService } = service();
    const giveUp = new AbortController();
    const leaving = read({ filesystemService, path: DATA, signal: giveUp.signal });
    const staying = read({ filesystemService, path: DATA });
    const query = await claimed(filesystemService);

    giveUp.abort();
    await expect(leaving).rejects.toThrow(GatewayTimeoutError);
    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });

    expect(await staying).toEqual(LISTING);
  });

  test('and the last one leaving takes it with them', async () => {
    const { filesystemService } = service();
    const giveUp = new AbortController();
    // Awaited together rather than one after the other: whichever is left unhandled in between
    // rejects into nothing, which the runner reports instead of the assertion.
    const abandoned = Promise.all([
      read({ filesystemService, path: DATA, signal: giveUp.signal }),
      read({ filesystemService, path: DATA, signal: giveUp.signal }),
    ]);
    await Bun.sleep(0);

    giveUp.abort();
    await expect(abandoned).rejects.toThrow(GatewayTimeoutError);

    expect(await handedTo({ filesystemService })).toBeUndefined();
  });
});

/**
 * Where the wait went. A host used to be told there was nothing and come back on a timer of its
 * own, so a directory opened a moment after one poll was not read until the next — half an idle
 * interval, on average, spent by somebody staring at a spinner while the host that could answer
 * had nothing to do.
 */
describe('a host with nothing to read waits here rather than on a timer of its own', () => {
  test('a read opening is what answers the host waiting for one', async () => {
    const { filesystemService } = service();
    const host = polling({ filesystemService });

    void read({ filesystemService, path: DATA });

    expect(await host).toMatchObject({ appId: APP_ID, path: DATA });
  });

  // A host is woken by the reads it could serve and by nothing else, or a fleet would be roused
  // by every directory anybody opened.
  test('a read for an app it does not serve leaves it waiting', async () => {
    const { filesystemService } = service();
    const host = polling({ filesystemService, servedAppIds: [OTHER_APP] });

    void read({ filesystemService, path: DATA });
    await Bun.sleep(0);

    expect(Bun.peek.status(host)).toBe('pending');
  });

  // The hold expiring is an ordinary answer rather than a failure: the host reopens the poll, and
  // a request nothing has travelled on is one every hop in between is entitled to close.
  test('a hold that expires with nothing standing answers with nothing', async () => {
    const { filesystemService } = service();

    const query = await polling({
      filesystemService,
      signal: AbortSignal.timeout(A_BRIEF_HOLD_MS),
    });

    expect(query).toBeUndefined();
  });

  // A host that has gone must take nothing with it: a read handed to a waiter nobody is listening
  // to is a read that is never performed and never offered again.
  test('a host that goes away leaves no waiter behind it', async () => {
    const { filesystemService } = service();
    const gone = new AbortController();
    const host = polling({ filesystemService, signal: gone.signal });

    gone.abort();
    expect(await host).toBeUndefined();
    void read({ filesystemService, path: DATA });

    expect(await offered(filesystemService)).toMatchObject({ path: DATA });
  });

  test('and a read handed to one that stayed is not offered to the next', async () => {
    const { filesystemService } = service();
    const host = polling({ filesystemService });
    void read({ filesystemService, path: DATA });
    await host;

    expect(await offered(filesystemService)).toBeUndefined();
  });
});

describe('a read that gets no usable answer says so rather than hanging', () => {
  test('a host that could not read the directory is a 502', async () => {
    const { filesystemService } = service();
    const listing = read({ filesystemService });
    const query = await claimed(filesystemService);

    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'failed', message: UNREADABLE_DEVICE },
    });

    await expect(listing).rejects.toThrow(BadGatewayError);
  });

  // The host names the device it failed on, which is an operator's to know and not a tenant's.
  test('and the host device it names never reaches the caller', async () => {
    const { filesystemService } = service();
    const listing = read({ filesystemService });
    const query = await claimed(filesystemService);

    filesystemService.acceptResult({
      queryId: query.queryId,
      outcome: { status: 'failed', message: UNREADABLE_DEVICE },
    });

    await expect(listing).rejects.not.toThrow('/dev/nbd7');
  });

  test('a caller that stops waiting is answered rather than left open', async () => {
    const { filesystemService } = service();
    const giveUp = new AbortController();
    const listing = read({ filesystemService, signal: giveUp.signal });
    await Bun.sleep(0);

    giveUp.abort();

    await expect(listing).rejects.toThrow(GatewayTimeoutError);
  });

  // The read existed only for the request holding it, so a host must not be sent to a device on
  // behalf of somebody who has gone.
  test('and their read stops being offered to hosts', async () => {
    const { filesystemService } = service();
    const giveUp = new AbortController();
    const listing = read({ filesystemService, signal: giveUp.signal });
    await Bun.sleep(0);

    giveUp.abort();
    await expect(listing).rejects.toThrow(GatewayTimeoutError);

    expect(await handedTo({ filesystemService })).toBeUndefined();
  });

  // A host answering a request that has already ended is late, not broken.
  test('an answer nobody is waiting for is dropped', () => {
    const { filesystemService } = service();

    expect(() =>
      filesystemService.acceptResult({
        queryId: 'query-nobody-asked-for' as never,
        outcome: { status: 'listed', listing: LISTING },
      }),
    ).not.toThrow();
  });
});

describe('who may read is decided before any host is asked', () => {
  test('a deployment the caller does not own is a 404 no host hears about', async () => {
    const { filesystemService } = service({ row: null });

    await expect(read({ filesystemService, ownerId: OTHER_OWNER_ID })).rejects.toThrow(
      NotFoundError,
    );
    expect(await offered(filesystemService)).toBeUndefined();
  });

  // Scoped in the query rather than compared afterwards, like every other read of a tenant row.
  test('ownership travels into the lookup', async () => {
    const subject = service();
    void read({ filesystemService: subject.filesystemService });
    await claimed(subject.filesystemService);

    expect(subject.deploymentsRepo.asked).toEqual([
      { appId: APP_ID, deploymentId: DEPLOYMENT_ID, ownerId: OWNER_ID },
    ]);
  });
});

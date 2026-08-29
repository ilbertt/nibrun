import { describe, expect, test } from 'bun:test';
import {
  type AgentSession,
  AppIdSchema,
  DEFAULT_AGENT_POLL_SETTINGS,
  type DirectoryListing,
  type FilesystemQuery,
  FilesystemQueryIdSchema,
  type FilesystemQueryRequest,
  type FilesystemQueryResult,
  GuestPathSchema,
  type HostVersions,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { type Duration, Effect, Fiber, Layer, TestClock, TestContext } from 'effect';
import { answer, filesystemLoop } from '#lib/agent/filesystem.ts';
import { GuestFilesystemRefused } from '#lib/filesystem/protocol.ts';
import { AgentSessionHolder } from '#services/agent-session-holder.service.ts';
import { ControlPlane } from '#services/control-plane.service.ts';
import { FilesystemReader, NoDeviceForApp } from '#services/filesystem-reader.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { recordingCommands } from '#tests/support/commands.ts';
import { agentConfig } from '#tests/support/config.ts';
import { platform } from '#tests/support/run.ts';

const APP = Value.Parse(AppIdSchema, 'app-pocketbase');
/** What the guest answers when nothing is at the path it was given. */
const NO_SUCH_PATH = 1;
const QUERY: FilesystemQuery = {
  queryId: Value.Parse(FilesystemQueryIdSchema, 'query-1'),
  appId: APP,
  path: Value.Parse(GuestPathSchema, '/'),
};

/** Measuring is the sixth loop's, not this one's: nothing here asks, so nothing here answers. */
const unmeasured: FilesystemReader['measure'] = () => Effect.die('nothing measures a guest here');

const LISTING: DirectoryListing = {
  path: Value.Parse(GuestPathSchema, '/'),
  entries: [
    {
      name: 'pb_data',
      kind: 'directory',
      sizeBytes: 4096,
      modifiedAt: Value.Parse(TimestampSchema, '2026-08-03T09:41:00Z'),
    },
  ],
  truncated: false,
};

/**
 * `CommandRunner` comes along because a real read shells out, and the stub keeps its signature.
 * Nothing here reaches it — a test that ran a subprocess would be testing the host, not this.
 */
function answering(list: FilesystemReader['list']) {
  const layer = Layer.merge(
    Layer.succeed(FilesystemReader, FilesystemReader.make({ list, measure: unmeasured })),
    recordingCommands().layer,
  );
  return Effect.runPromise(Effect.provide(answer(QUERY), layer));
}

// Somebody is holding a request open on the other end of this, so silence is the one outcome
// that helps nobody: it turns a refusal they could act on into a timeout they cannot.
describe('a query is answered whatever the read did', () => {
  test('a directory that was read comes back as it was read', async () => {
    const result = await answering(() => Effect.succeed(LISTING));

    expect(result).toEqual({
      queryId: QUERY.queryId,
      outcome: { status: 'listed', listing: LISTING },
    });
  });

  test('a device this host does not hold is still an answer', async () => {
    const result = await answering(() => new NoDeviceForApp({ appId: APP }));

    expect(result.queryId).toBe(QUERY.queryId);
    expect(result.outcome.status).toBe('failed');
  });

  test('a directory the guest would not read is too', async () => {
    const result = await answering(
      () => new GuestFilesystemRefused({ appId: APP, status: NO_SUCH_PATH }),
    );

    expect(result.outcome.status).toBe('failed');
  });

  // The message reaches whoever asked, so it has to read as a sentence rather than as a tag —
  // and it names the app rather than the path, which is the tenant's to know.
  test('a failure explains itself without quoting what was asked for', async () => {
    const result = await answering(
      () => new GuestFilesystemRefused({ appId: APP, status: NO_SUCH_PATH }),
    );

    if (result.outcome.status !== 'failed') {
      throw new Error('a failed read must answer with a failure');
    }
    expect(result.outcome.message).toContain(APP);
    expect(result.outcome.message).not.toContain('GuestFilesystemRefused');
  });
});

// Virtual time, so a test that spans three polls of a five-second floor still runs in an instant.
const NO_TIME_AT_ALL: Duration.DurationInput = '0 millis';
const TWO_FLOORS_AND_A_MOMENT: Duration.DurationInput = '12 seconds';
const POLLS_ACROSS_TWO_FLOORS = 3;

const SESSION = {
  hostId: 'host-1',
  sessionToken: 'session-token',
  expiresAt: '2026-08-03T11:00:00Z',
  poll: DEFAULT_AGENT_POLL_SETTINGS,
} as AgentSession;

function unreached() {
  return Effect.dieMessage('the filesystem loop speaks on its own two routes and no others');
}

/**
 * An api that answers a poll the instant it arrives rather than holding it open — which is what an
 * api deployed before the hold does, and what stands in front of a new agent for the length of
 * every rollout. Whatever is queued comes back first; every poll after that finds nothing.
 */
function immediateApi(queued: FilesystemQuery[]) {
  const polls: FilesystemQueryRequest[] = [];
  const answers: FilesystemQueryResult[] = [];
  const layer = Layer.succeed(
    ControlPlane,
    ControlPlane.make({
      openSession: unreached,
      fetchDesiredState: unreached,
      sendReportedState: unreached,
      fetchFilesystemQuery: ({ request }: { request: FilesystemQueryRequest }) =>
        Effect.sync(() => {
          polls.push(request);
          const query = queued.shift();
          return query ? { result: 'query' as const, query } : { result: 'none' as const };
        }),
      sendFilesystemQueryResult: ({ result }: { result: FilesystemQueryResult }) =>
        Effect.sync(() => {
          answers.push(result);
        }),
    }),
  );
  return { polls, answers, layer };
}

const sessionHolder = Layer.succeed(
  AgentSessionHolder,
  AgentSessionHolder.make({
    versions: {} as HostVersions,
    current: Effect.succeed(SESSION),
    pollSettings: Effect.succeed(SESSION.poll),
    onExpired: () => Effect.void,
  }),
);

// What a read would reach for on a host, none of which is reached here: the stub above keeps the
// reader's signature, and a signature that shells out is one the layer has to satisfy.
const host = Layer.mergeAll(agentConfig(), platform, recordingCommands().layer);

// The real allocator over a slots file nothing wrote: a host holding no volume serves no app,
// which is what an idle poll carries.
const slots = Layer.provide(SlotAllocator.DefaultWithoutDependencies, host);

const reader = Layer.succeed(
  FilesystemReader,
  FilesystemReader.make({ list: () => Effect.succeed(LISTING), measure: unmeasured }),
);

/**
 * The loop over virtual time, so what is asserted is the cadence rather than the clock. Everything
 * the api answers is instant here, which leaves the floor as the only thing that can space two
 * polls apart.
 */
async function polling({
  queued = [],
  over,
}: {
  queued?: FilesystemQuery[];
  over: Duration.DurationInput;
}) {
  const api = immediateApi(queued);
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const loop = yield* Effect.fork(filesystemLoop);
        yield* TestClock.adjust(over);
        yield* Fiber.interrupt(loop);
      }),
      Layer.mergeAll(api.layer, sessionHolder, slots, reader, host, TestContext.TestContext),
    ),
  );
  return api;
}

/**
 * The api holds an idle poll open, so the floor below is spent only against one that does not —
 * and an agent is in front of exactly that api for the length of every rollout. Without it the two
 * would spin against each other as fast as the network allows.
 */
describe('a poll that comes straight back is not repeated straight away', () => {
  test('an idle host polls once and waits out the floor', async () => {
    expect((await polling({ over: NO_TIME_AT_ALL })).polls).toHaveLength(1);
  });

  test('and asks again once, and only once, per interval it has waited', async () => {
    expect((await polling({ over: TWO_FLOORS_AND_A_MOMENT })).polls).toHaveLength(
      POLLS_ACROSS_TWO_FLOORS,
    );
  });

  // The floor is under an idle poll and nothing else: a host that was given a read answers it and
  // asks for the next one at once, because somebody is waiting on both.
  test('a read that came back is answered and the next poll opens immediately', async () => {
    const { polls, answers } = await polling({ queued: [QUERY], over: NO_TIME_AT_ALL });

    expect(answers).toEqual([
      { queryId: QUERY.queryId, outcome: { status: 'listed', listing: LISTING } },
    ]);
    expect(polls).toHaveLength(2);
  });
});

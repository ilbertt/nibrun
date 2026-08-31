import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Duration, Effect, Fiber } from 'effect';
import {
  createSnapshot,
  type FirecrackerApiError,
  loadSnapshot,
  pause,
  resume,
} from '#lib/vm/firecracker-api.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;

/** Long enough that the load has certainly failed to connect at least once before anything binds. */
const LATE_BIND_MS = 100;

type ReceivedCall = { readonly method: string; readonly path: string; readonly body: unknown };

/**
 * A listening unix socket rather than a substituted `fetch`: the request Firecracker would have
 * to recognise is the thing under test, and the only honest way to read one is to receive it.
 */
function servingApi({ socketPath, fault }: { socketPath: string; fault?: string }) {
  const received: ReceivedCall[] = [];
  return Effect.as(
    Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          unix: socketPath,
          fetch: async (request) => {
            received.push({
              method: request.method,
              path: new URL(request.url).pathname,
              body: await request.json(),
            });
            return fault === undefined
              ? new Response(null, { status: HTTP_NO_CONTENT })
              : Response.json({ fault_message: fault }, { status: HTTP_BAD_REQUEST });
          },
        }),
      ),
      (server) => Effect.asVoid(Effect.sync(() => server.stop(true))),
    ),
    received,
  );
}

function files({ socketPath }: { socketPath: string }) {
  return {
    socketPath,
    statePath: '/data/nibrun-vm/app/vmstate',
    memoryPath: '/data/nibrun-vm/app/memory',
  };
}

function against({
  fault,
  call,
}: {
  fault?: string;
  call: (socketPath: string) => Effect.Effect<void, FirecrackerApiError>;
}) {
  return run(
    Effect.gen(function* () {
      const socketPath = join(yield* temporaryDirectory, 'vm.sock');
      const received = yield* servingApi({ socketPath, ...(fault === undefined ? {} : { fault }) });
      const outcome = yield* Effect.either(call(socketPath));
      return { received, outcome };
    }),
  );
}

// Firecracker 1.16.1 mounts one method on /vm and rejects the other outright, and the two
// snapshot bodies name fields a neighbouring version spells differently — so what is asserted
// here is the wire shape rather than that this module can reach a socket.
describe('the requests are the ones Firecracker 1.16.1 answers', () => {
  test('a pause and a resume are both PATCH on /vm', async () => {
    const { received } = await against({
      call: (socketPath) => Effect.andThen(pause(socketPath), resume(socketPath)),
    });
    expect(received).toEqual([
      { method: 'PATCH', path: '/vm', body: { state: 'Paused' } },
      { method: 'PATCH', path: '/vm', body: { state: 'Resumed' } },
    ]);
  });

  test('a create names both files and asks for a full snapshot', async () => {
    const { received } = await against({
      call: (socketPath) => createSnapshot(files({ socketPath })),
    });
    expect(received[0]).toEqual({
      method: 'PUT',
      path: '/snapshot/create',
      body: {
        snapshot_path: '/data/nibrun-vm/app/vmstate',
        mem_file_path: '/data/nibrun-vm/app/memory',
        snapshot_type: 'Full',
      },
    });
  });

  // The two spellings are mutually exclusive: sending both is a refusal rather than a preference.
  test('a load carries mem_backend and never the deprecated mem_file_path', async () => {
    const { received } = await against({
      call: (socketPath) => loadSnapshot(files({ socketPath })),
    });
    expect(received[0]).toEqual({
      method: 'PUT',
      path: '/snapshot/load',
      body: {
        snapshot_path: '/data/nibrun-vm/app/vmstate',
        mem_backend: { backend_type: 'File', backend_path: '/data/nibrun-vm/app/memory' },
        clock_realtime: true,
      },
    });
  });

  // Asserted on its own because the default is silent breakage: kvmclock is the guest's only
  // wall clock, so a load that omitted this would restore a guest as far in the past as it slept
  // and every certificate it checked would read as not yet valid.
  test('a load advances the guest clock by the time it was asleep', async () => {
    const { received } = await against({
      call: (socketPath) => loadSnapshot(files({ socketPath })),
    });
    expect(received[0]?.body).toHaveProperty('clock_realtime', true);
  });
});

test("a refusal is reported as the VMM's own account of it", async () => {
  const { outcome } = await against({
    fault: 'Cannot pause microVM',
    call: (socketPath) => pause(socketPath),
  });
  expect(outcome._tag === 'Left' && outcome.left.message).toContain('Cannot pause microVM');
});

// systemd calls a Type=exec unit started at the exec, which is before Firecracker has bound
// anything — so the first call of a restore has to outlast a socket that is not there yet.
test('a load waits for a Firecracker that has not bound its socket', async () => {
  await run(
    Effect.gen(function* () {
      const socketPath = join(yield* temporaryDirectory, 'vm.sock');
      const loading = yield* Effect.fork(loadSnapshot(files({ socketPath })));
      yield* Effect.sleep(Duration.millis(LATE_BIND_MS));
      const received = yield* servingApi({ socketPath });
      yield* Fiber.join(loading);
      expect(received).toHaveLength(1);
    }),
  );
});

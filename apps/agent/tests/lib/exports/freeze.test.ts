import { describe, expect, test } from 'bun:test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import { frozen } from '#lib/exports/freeze.ts';
import { GUEST_VSOCK_FILENAME } from '#lib/vm/vsock.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const APP_ID: AppId = Value.Parse(AppIdSchema, 'pocketbase-8zv0ch');

const run = provided(platform);

type GuestBehaviour = {
  readonly onConnect?: string;
  readonly onFreeze?: string;
  readonly hangUpAfterFreezing?: boolean;
};

/**
 * Firecracker's end of the vsock device, which is a plain unix socket speaking a text handshake
 * before the stream becomes the guest's. Standing it up for real is the only way to cover the
 * part that matters: what the agent does when the answer is not the one it wanted.
 */
const fakeVmm = ({ vmDir, behaviour }: { vmDir: string; behaviour: GuestBehaviour }) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const workingDir = join(vmDir, APP_ID);
      await mkdir(workingDir, { recursive: true });
      const { onConnect = 'OK 1024\n', onFreeze = 'OK\n', hangUpAfterFreezing = false } = behaviour;
      return Bun.listen({
        unix: join(workingDir, GUEST_VSOCK_FILENAME),
        socket: {
          // biome-ignore lint/complexity/useMaxParams: Bun hands a socket handler its own socket
          data: (socket, chunk) => {
            const request = chunk.toString();
            if (request.startsWith('CONNECT')) {
              socket.write(onConnect);
              return;
            }
            socket.write(onFreeze);
            if (hangUpAfterFreezing) {
              socket.end();
            }
          },
        },
      });
    }),
    (server) => Effect.sync(() => server.stop(true)),
  );

const HELD = 'held';
const BUNDLE_TIME = '50 millis';

/**
 * What the export would do with the lease: take it, spend time on the bundle, and ask whether it
 * still holds before trusting a byte of what it read. The pause is what gives a guest that hangs
 * up the chance to, so the answer is about the lease rather than about scheduling.
 */
const outcome = ({ vmDir }: { vmDir: string }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const lease = yield* frozen({ appId: APP_ID, vmDir });
      yield* Effect.sleep(BUNDLE_TIME);
      yield* lease.assertHeld;
      return HELD;
    }),
  ).pipe(Effect.catchAll((error) => Effect.succeed(error._tag)));
describe('freezing a tenant filesystem before it is read', () => {
  test('holds the freeze the guest granted', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        yield* fakeVmm({ vmDir, behaviour: {} });
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe(HELD);
  });

  /* A guest that thawed on its own deadline leaves a bundle nobody can vouch for, and the export
   * has to say so rather than upload it. */
  test('reports the freeze lost when the guest thawed before the bundle was finished', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        yield* fakeVmm({ vmDir, behaviour: { hangUpAfterFreezing: true } });
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe('FreezeLost');
  });

  test('reports a guest that would not freeze at all', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        yield* fakeVmm({ vmDir, behaviour: { onFreeze: 'ERR the data filesystem is gone\n' } });
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe('FreezeRefused');
  });

  /* The VMM is there, so the tenant is writing; nothing answering the control port is a guest
   * whose journal the bundle would miss without saying so. */
  test('refuses a running VMM with nothing listening on the control port', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        yield* fakeVmm({ vmDir, behaviour: { onConnect: 'FAILED\n' } });
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe('GuestPortUnreachable');
  });

  /* A stopped app unmounted its filesystem on the way down, which empties the journal for the
   * same reason a freeze does. */
  test('reads the volume as it lies when no VMM is running', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe(HELD);
  });
});

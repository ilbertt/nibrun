import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import { Effect } from 'effect';
import { frozen } from '#lib/exports/freeze.ts';
import { fakeGuest } from '#tests/support/guest.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const APP_ID: AppId = Value.Parse(AppIdSchema, 'pocketbase-8zv0ch');

const run = provided(platform);

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
        yield* fakeGuest({ vmDir, appId: APP_ID });
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
        yield* fakeGuest({ vmDir, appId: APP_ID, behaviour: { hangUpAfterFreezing: true } });
        return yield* outcome({ vmDir });
      }),
    );

    expect(held).toBe('FreezeLost');
  });

  test('reports a guest that would not freeze at all', async () => {
    const held = await run(
      Effect.gen(function* () {
        const vmDir = yield* temporaryDirectory;
        yield* fakeGuest({
          vmDir,
          appId: APP_ID,
          behaviour: { onFreeze: 'ERR the data filesystem is gone\n' },
        });
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
        yield* fakeGuest({ vmDir, appId: APP_ID, behaviour: { onConnect: 'FAILED\n' } });
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

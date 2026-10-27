import { expect, test } from 'bun:test';
import { AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Deferred, Effect, Fiber, Layer, Ref } from 'effect';
import { AgentState } from '#services/agent-state.service.ts';
import { VolumeMigrationFences } from '#services/volume-migration-fences.service.ts';
import { APP_ID } from '#tests/support/fixtures.ts';
import { provided } from '#tests/support/run.ts';

const OTHER_APP = Value.Parse(AppIdSchema, 'other-app');
const run = provided(Layer.mergeAll(VolumeMigrationFences.Default, AgentState.Default));

test('a fence refuses new admissions and waits for all already-admitted lifecycle work', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const active = yield* fences
        .access({
          appIds: [APP_ID],
          use: () =>
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish))),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const secondStarted = yield* Deferred.make<void>();
      const secondFinish = yield* Deferred.make<void>();
      const second = yield* fences
        .access({
          appIds: [APP_ID],
          use: () =>
            Deferred.succeed(secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(secondFinish)),
            ),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(secondStarted);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const held = yield* fences
        .during({
          appId: APP_ID,
          effect: Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      expect(yield* Deferred.isDone(entered)).toBe(false);
      expect(yield* Effect.isFailure(fences.requireHeld(APP_ID))).toBe(true);
      yield* fences.access({
        appIds: [APP_ID, OTHER_APP],
        use: (blocked) =>
          Effect.sync(() => {
            expect(blocked.has(APP_ID)).toBe(true);
            expect(blocked.has(OTHER_APP)).toBe(false);
          }),
      });
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(active);
      expect(yield* Deferred.isDone(entered)).toBe(false);
      yield* Deferred.succeed(secondFinish, undefined);
      yield* Fiber.join(second);
      yield* Deferred.await(entered);
      yield* fences.requireHeld(APP_ID);
      expect(yield* Effect.isFailure(fences.during({ appId: APP_ID, effect: Effect.void }))).toBe(
        true,
      );
      yield* fences.during({ appId: OTHER_APP, effect: Effect.void });
      yield* AgentState.modify((current) => ({ ...current, deferredWork: false }));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(held);
      expect(yield* Effect.isFailure(fences.requireHeld(APP_ID))).toBe(true);
      expect((yield* AgentState.snapshot).deferredWork).toBe(true);
      yield* fences.access({
        appIds: [APP_ID],
        use: (blocked) => Effect.sync(() => expect(blocked.size).toBe(0)),
      });
    }),
  ));

test('unfenced lifecycle admissions remain concurrent', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      const entered = yield* Deferred.make<void>();
      const first = yield* fences
        .access({
          appIds: [APP_ID],
          use: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* fences.access({
        appIds: [APP_ID],
        use: (blocked) => Effect.sync(() => expect(blocked.size).toBe(0)),
      });
      yield* Fiber.interrupt(first);
      yield* fences.during({ appId: APP_ID, effect: Effect.void });
    }),
  ));

test('cancelling a waiting fence does not cancel admitted work or leave admission blocked', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      const started = yield* Deferred.make<void>();
      const active = yield* fences
        .access({
          appIds: [APP_ID],
          use: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      const ran = yield* Ref.make(false);
      const held = yield* fences
        .during({ appId: APP_ID, effect: Ref.set(ran, true) })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow();
      yield* Fiber.interrupt(held);
      expect(yield* Ref.get(ran)).toBe(false);
      expect((yield* Fiber.poll(active))._tag).toBe('None');
      yield* fences.access({
        appIds: [APP_ID],
        use: (blocked) => Effect.sync(() => expect(blocked.size).toBe(0)),
      });
      yield* Fiber.interrupt(active);
      yield* fences.during({ appId: APP_ID, effect: Effect.void });
    }),
  ));

test('failed or interrupted migration work releases its fence', () =>
  run(
    Effect.gen(function* () {
      const fences = yield* VolumeMigrationFences;
      expect(
        yield* fences.during({ appId: APP_ID, effect: Effect.fail('failed') }).pipe(Effect.flip),
      ).toBe('failed');
      const entered = yield* Deferred.make<void>();
      const held = yield* fences
        .during({
          appId: APP_ID,
          effect: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(held);
      yield* fences.during({ appId: APP_ID, effect: Effect.void });
    }),
  ));

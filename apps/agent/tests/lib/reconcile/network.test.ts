import { describe, expect, test } from 'bun:test';
import { AppIdSchema, DEFAULT_HTTP_PORT, INSTANCE_STATES, Value } from '@repo/protocol';
import { Effect, Layer, Option } from 'effect';
import { forwardedInstances } from '#lib/reconcile/network.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { AgentState } from '#services/agent-state.service.ts';
import { SlotAllocator } from '#services/slot-allocator.service.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID, instanceRecord } from '#tests/support/fixtures.ts';
import { platform, provided } from '#tests/support/run.ts';

const OTHER_APP_ID = Value.Parse(AppIdSchema, 'app-2');

/** Everything a record can say other than that the tenant has answered. */
const DOWN_STATES = INSTANCE_STATES.filter((state) => state !== 'running');

const run = provided(
  Layer.mergeAll(
    AgentState.Default,
    SlotAllocator.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
  ).pipe(Layer.provideMerge(platform)),
);

/** What a host looks like once every one of these apps has been placed on it. */
function forwardsFor(records: readonly InstanceRecord[]) {
  return Effect.gen(function* () {
    const allocator = yield* SlotAllocator;
    for (const record of records) {
      yield* allocator.allocate(record.appId);
      yield* AgentState.putRecord(record);
    }
    return yield* forwardedInstances;
  });
}

describe('the forward is what decides whether a port reaches the guest', () => {
  test.each(DOWN_STATES)('a %s instance is not forwarded', (state) =>
    run(
      Effect.gen(function* () {
        expect(yield* forwardsFor([instanceRecord({ state })])).toEqual([]);
      }),
    ),
  );

  test('a running instance is forwarded onto the guest its slot describes', () =>
    run(
      Effect.gen(function* () {
        const forwarded = yield* forwardsFor([instanceRecord()]);
        const allocator = yield* SlotAllocator;
        const slot = Option.getOrThrow(yield* allocator.lookup(APP_ID));

        expect(forwarded).toEqual([
          {
            hostPort: slot.hostPort,
            httpPort: DEFAULT_HTTP_PORT,
            hostIpv4: slot.hostIpv4,
            guestIpv4: slot.guestIpv4,
          },
        ]);
      }),
    ));

  test('a host holding two apps and running one forwards only that one', () =>
    run(
      Effect.gen(function* () {
        const forwarded = yield* forwardsFor([
          instanceRecord({ state: 'stopped' }),
          instanceRecord({ appId: OTHER_APP_ID }),
        ]);

        expect(forwarded).toHaveLength(1);
      }),
    ));
});

describe('an app is forwarded the port it asked for and no other', () => {
  test('one that asked takes the port its slot names', () =>
    run(
      Effect.gen(function* () {
        const [forwarded] = yield* forwardsFor([instanceRecord({ hasExtraPublicPort: true })]);
        const slot = Option.getOrThrow(yield* (yield* SlotAllocator).lookup(APP_ID));

        expect(forwarded?.extraPublicPort).toBe(slot.extraPublicPort);
      }),
    ));

  // Absent rather than present-and-ignored: what renders the rules reads the field's presence, so
  // an app that did not ask has to be indistinguishable from one that could not have.
  test('one that did not carries no port at all', () =>
    run(
      Effect.gen(function* () {
        const [forwarded] = yield* forwardsFor([instanceRecord()]);

        expect(forwarded && 'extraPublicPort' in forwarded).toBe(false);
      }),
    ));

  // A note written before an app could ask for one says nothing, and reads as the no it meant.
  test('a record that predates the question is read as a no', () =>
    run(
      Effect.gen(function* () {
        const { hasExtraPublicPort: _, ...older } = instanceRecord({ hasExtraPublicPort: true });
        const [forwarded] = yield* forwardsFor([older]);

        expect(forwarded && 'extraPublicPort' in forwarded).toBe(false);
      }),
    ));
});

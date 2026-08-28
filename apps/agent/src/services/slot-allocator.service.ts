import type { AppId } from '@repo/protocol';
import { Effect, Either, Option, Ref } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import {
  type Assignments,
  assignmentsFrom,
  readSlotCursor,
  readSlotRecords,
  SlotExhausted,
} from '#lib/network/allocator.ts';
import { type AppSlot, describeSlot, FIRST_SLOT, SLOT_COUNT } from '#lib/network/slot.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

const SLOT_SPAN = SLOT_COUNT - FIRST_SLOT;

/** Twice, because a cursor read off disk may be negative and `%` keeps the sign. */
function wrapped(offset: number): number {
  return FIRST_SLOT + (((offset % SLOT_SPAN) + SLOT_SPAN) % SLOT_SPAN);
}

type Allocation = Either.Either<{ slot: AppSlot; fresh: boolean }, SlotExhausted>;

/**
 * The next free slot at or after the cursor rather than the lowest free one, wrapping once so the
 * scan still ends. A slot only comes back when its app's volume is torn down, and handing it
 * straight to the next app makes an address a client may still be dialling somebody else's — so a
 * freed slot waits for the cursor to come round to it, which is every other slot first.
 */
const nextFree = ({ assignments, from }: { assignments: Assignments; from: number }) => {
  const taken = new Set(assignments.values());
  for (let step = 0; step < SLOT_SPAN; step += 1) {
    const slot = wrapped(from - FIRST_SLOT + step);
    if (!taken.has(slot)) {
      return slot;
    }
  }
  return undefined;
};

const withSlot = ({ assignments, appId }: { assignments: Assignments; appId: AppId }) =>
  Option.map(Option.fromNullable(assignments.get(appId)), (slot) => describeSlot({ slot, appId }));

/**
 * Slots are per app, never per instance, so a redeploy is invisible to routing. They are released
 * only on an explicit volume `absent`: reusing a port sooner would route one tenant into another.
 */
export class SlotAllocator extends Effect.Service<SlotAllocator>()('SlotAllocator', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    const stored = yield* readJsonFile(config.slotsFile);
    const ref = yield* Ref.make(assignmentsFrom(readSlotRecords(Option.getOrUndefined(stored))));
    const storedCursor = yield* readJsonFile(config.slotCursorFile);
    const cursorRef = yield* Ref.make(readSlotCursor(Option.getOrUndefined(storedCursor)));

    return {
      allocate: (appId: AppId) =>
        Effect.gen(function* () {
          const from = yield* Ref.get(cursorRef);
          const taken = yield* Effect.flatten(
            Ref.modify(ref, (assignments): readonly [Allocation, Assignments] => {
              const existing = withSlot({ assignments, appId });
              if (Option.isSome(existing)) {
                return [Either.right({ slot: existing.value, fresh: false }), assignments];
              }
              const free = nextFree({ assignments, from });
              if (free === undefined) {
                return [Either.left(new SlotExhausted({ limit: SLOT_COUNT })), assignments];
              }
              return [
                Either.right({ slot: describeSlot({ slot: free, appId }), fresh: true }),
                new Map(assignments).set(appId, free),
              ];
            }),
          );
          // Only past a slot this just gave away. An app being handed the one it already holds is
          // every redeploy, and moving the cursor there would leave it wherever the last redeploy
          // happened to be — which is as likely to sit on a freed slot as anywhere else.
          if (taken.fresh) {
            yield* Ref.set(cursorRef, taken.slot.slot + 1);
          }
          return taken.slot;
        }),

      lookup: (appId: AppId) =>
        Effect.map(Ref.get(ref), (assignments) => withSlot({ assignments, appId })),

      release: (appId: AppId) =>
        Ref.update(ref, (assignments) => {
          const next = new Map(assignments);
          next.delete(appId);
          return next;
        }),

      slots: Effect.map(Ref.get(ref), (assignments) =>
        [...assignments].map(([appId, slot]) => describeSlot({ slot, appId })),
      ),

      persist: Effect.gen(function* () {
        const assignments = yield* Ref.get(ref);
        yield* writeJsonFile({ path: config.slotsFile, value: Object.fromEntries(assignments) });
        // After the slots, and never in place of them: a cursor written without them would point
        // past allocations the next boot has no record of.
        yield* writeJsonFile({ path: config.slotCursorFile, value: yield* Ref.get(cursorRef) });
      }),
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}

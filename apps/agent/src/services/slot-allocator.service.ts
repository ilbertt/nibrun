import type { AppId } from '@repo/protocol';
import { Effect, Either, Option, Ref } from 'effect';
import { readJsonFile, writeJsonFile } from '#lib/json-store.ts';
import {
  type Assignments,
  assignmentsFrom,
  readSlotRecords,
  SlotExhausted,
} from '#network/allocator.ts';
import { type AppSlot, describeSlot, FIRST_SLOT, SLOT_COUNT } from '#network/slot.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

const firstFree = (assignments: Assignments) => {
  const taken = new Set(assignments.values());
  for (let slot = FIRST_SLOT; slot < SLOT_COUNT; slot += 1) {
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

    return {
      allocate: (appId: AppId) =>
        Effect.flatten(
          Ref.modify(
            ref,
            (assignments): readonly [Either.Either<AppSlot, SlotExhausted>, Assignments] => {
              const existing = withSlot({ assignments, appId });
              if (Option.isSome(existing)) {
                return [Either.right(existing.value), assignments];
              }
              const slot = firstFree(assignments);
              if (slot === undefined) {
                return [Either.left(new SlotExhausted({ limit: SLOT_COUNT })), assignments];
              }
              return [
                Either.right(describeSlot({ slot, appId })),
                new Map(assignments).set(appId, slot),
              ];
            },
          ),
        ),

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

      persist: Effect.flatMap(Ref.get(ref), (assignments) =>
        writeJsonFile({ path: config.slotsFile, value: Object.fromEntries(assignments) }),
      ),
    };
  }),
  dependencies: [AgentConfig.Default],
}) {}

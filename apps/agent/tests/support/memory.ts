import { Effect, Layer } from 'effect';
import type { HostMemorySample } from '#lib/report/memory.ts';
import { HostMemory } from '#services/host-memory.service.ts';

export const HOST_MEMORY_SAMPLE: HostMemorySample = {
  totalMib: 16_384,
  availableMib: 12_288,
  zerofsMemoryMib: 2048,
  zerofsReserveMib: 6144,
  guestCapacityMib: 9216,
  guestAvailableMib: 11_264,
};

export function hostMemory(
  read: Effect.Effect<HostMemorySample | undefined> = Effect.succeed(HOST_MEMORY_SAMPLE),
) {
  return Layer.effect(
    HostMemory,
    Effect.gen(function* () {
      const semaphore = yield* Effect.makeSemaphore(1);
      function serialize<A, E, R>(effect: Effect.Effect<A, E, R>) {
        return semaphore.withPermits(1)(effect);
      }
      return HostMemory.make({ read, serialize });
    }),
  );
}

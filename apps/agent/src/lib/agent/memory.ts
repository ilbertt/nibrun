import { Effect, Schedule } from 'effect';
import { HOST_MEMORY_POLICY } from '#lib/report/memory.ts';
import { HostMemory } from '#services/host-memory.service.ts';

export const memoryLoop = Effect.flatMap(HostMemory, (memory) =>
  memory.read.pipe(Effect.repeat(Schedule.spaced(HOST_MEMORY_POLICY.logIntervalMs))),
);

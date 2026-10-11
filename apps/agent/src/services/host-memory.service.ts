import { FileSystem } from '@effect/platform';
import { Clock, Effect, Either, Ref } from 'effect';
import { HOST_MEMORY_POLICY, readMemorySample } from '#lib/report/memory.ts';
import { readCacheMemoryBytes } from '#lib/volumes/zerofs.ts';
import { AgentConfig } from '#services/agent-config.service.ts';

export class HostMemory extends Effect.Service<HostMemory>()('HostMemory', {
  effect: Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* AgentConfig;
    const lastLoggedAt = yield* Ref.make(-HOST_MEMORY_POLICY.logIntervalMs);
    const starts = yield* Effect.makeSemaphore(1);
    const read = Effect.gen(function* () {
      const result = yield* Effect.either(
        Effect.all({
          meminfo: fs.readFileString('/proc/meminfo'),
          zerofsCurrentBytes: fs.readFileString(
            '/sys/fs/cgroup/system.slice/nibrun-zerofs.service/memory.current',
          ),
          zerofsCacheBytes: readCacheMemoryBytes(config.zerofsConfigFile).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
          ),
        }).pipe(
          Effect.flatMap((values) =>
            Effect.try(() =>
              readMemorySample({
                ...values,
                zerofsReserveMib: config.zerofsMemoryReserveMib,
              }),
            ),
          ),
        ),
      );
      const nowMs = yield* Clock.currentTimeMillis;
      const shouldLog = yield* Ref.modify(lastLoggedAt, (previousMs) =>
        nowMs - previousMs >= HOST_MEMORY_POLICY.logIntervalMs
          ? [true, nowMs]
          : [false, previousMs],
      );
      if (shouldLog) {
        if (Either.isLeft(result)) {
          yield* Effect.logWarning(
            'host memory accounting unavailable; new VM starts deferred',
            result.left,
          );
        } else {
          const sample = result.right;
          const pressured =
            sample.guestAvailableMib === 0 ||
            sample.zerofsMemoryMib > config.zerofsMemoryReserveMib;
          yield* (
            pressured
              ? Effect.logWarning('host memory pressure')
              : Effect.logInfo('host memory sampled')
          ).pipe(Effect.annotateLogs(sample));
        }
      }
      return Either.isRight(result) ? result.right : undefined;
    });
    function serialize<A, E, R>(effect: Effect.Effect<A, E, R>) {
      return starts.withPermits(1)(effect);
    }
    return { read, serialize };
  }),
  dependencies: [AgentConfig.Default],
}) {}

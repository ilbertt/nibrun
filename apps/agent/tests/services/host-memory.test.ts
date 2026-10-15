import { expect, test } from 'bun:test';
import { FileSystem } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { AgentConfig } from '#services/agent-config.service.ts';
import { HostMemory } from '#services/host-memory.service.ts';
import { AGENT_CONFIG } from '#tests/support/config.ts';
import { provided } from '#tests/support/run.ts';

const EXPECTED_GUEST_CAPACITY_MIB = 9216;

function memoryReader(meminfo: string) {
  const filesystem = FileSystem.layerNoop({
    exists: () => Effect.succeed(true),
    readFileString: (path) =>
      Effect.succeed(
        path === '/proc/meminfo'
          ? meminfo
          : path.endsWith('memory.current')
            ? '2147483648'
            : '[cache]\nmemory_size_gb = 2\n',
      ),
  });
  const config = Layer.succeed(AgentConfig, { ...AGENT_CONFIG } as unknown as AgentConfig);
  return provided(
    HostMemory.DefaultWithoutDependencies.pipe(Layer.provide(Layer.merge(filesystem, config))),
  );
}

test('reads Linux memory and ZeroFS cgroup accounting', () =>
  memoryReader('MemTotal: 16777216 kB\nMemAvailable: 12582912 kB\n')(
    Effect.gen(function* () {
      const memory = yield* HostMemory;
      expect((yield* memory.read)?.guestCapacityMib).toBe(EXPECTED_GUEST_CAPACITY_MIB);
    }),
  ));

test('invalid accounting fails closed rather than assuming free memory', () =>
  memoryReader('MemTotal: invalid')(
    Effect.gen(function* () {
      const memory = yield* HostMemory;
      expect(yield* memory.read).toBeUndefined();
    }),
  ));

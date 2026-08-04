import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { ZerofsTopology } from '#volumes/topology.ts';

function topology() {
  return Effect.runSync(
    Effect.provide(
      ZerofsTopology,
      ZerofsTopology.DefaultWithoutDependencies.pipe(Layer.provide(agentConfig())),
    ),
  );
}

describe('the host decides where a volume goes', () => {
  test('a volume is placed in the filesystem this host serves', () => {
    const filesystem = topology().place();

    expect(filesystem.storagePrefix).toBe(AGENT_CONFIG.zerofsStoragePrefix);
    expect(filesystem.mountPath).toBe(AGENT_CONFIG.zerofsMount);
    expect(filesystem.nbdSocketPath).toBe(AGENT_CONFIG.zerofsNbdSocket);
    expect(filesystem.admin.configFile).toBe(AGENT_CONFIG.zerofsConfigFile);
  });

  test('placing twice lands in the same filesystem', () => {
    const host = topology();

    expect(host.place().storagePrefix).toBe(host.place().storagePrefix);
  });

  test('the whole set is enumerable, which is what a fleet-wide flush needs', () => {
    expect(topology().all.map((filesystem) => filesystem.storagePrefix)).toEqual([
      AGENT_CONFIG.zerofsStoragePrefix,
    ]);
  });
});

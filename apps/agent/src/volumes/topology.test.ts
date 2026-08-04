import { describe, expect, test } from 'bun:test';
import type { ObjectKey } from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { AgentConfig } from '#config.ts';
import { ZerofsTopology } from '#volumes/topology.ts';

const HOST_PREFIX = 'filesystems/host-1' as ObjectKey;

const config = Layer.succeed(AgentConfig, {
  zerofsStoragePrefix: HOST_PREFIX,
  zerofsMount: '/mnt/zerofs',
  zerofsNbdSocket: '/run/zerofs/nbd.sock',
  zerofsBinary: '/opt/nibrun/bin/zerofs/zerofs',
  zerofsConfigFile: '/etc/zerofs/config.toml',
} as unknown as AgentConfig);

const topology = () =>
  Effect.runSync(
    Effect.provide(ZerofsTopology, ZerofsTopology.Default.pipe(Layer.provide(config))),
  );

describe('the host decides where a volume goes', () => {
  test('a volume is placed in the filesystem this host serves', () => {
    const filesystem = topology().place();

    expect(filesystem.storagePrefix).toBe(HOST_PREFIX);
    expect(filesystem.mountPath).toBe('/mnt/zerofs');
    expect(filesystem.nbdSocketPath).toBe('/run/zerofs/nbd.sock');
    expect(filesystem.admin.configFile).toBe('/etc/zerofs/config.toml');
  });

  test('placing twice lands in the same filesystem', () => {
    const host = topology();

    expect(host.place().storagePrefix).toBe(host.place().storagePrefix);
  });

  test('the whole set is enumerable, which is what a fleet-wide flush needs', () => {
    expect(topology().all.map((filesystem) => filesystem.storagePrefix)).toEqual([HOST_PREFIX]);
  });
});

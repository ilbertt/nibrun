import { describe, expect, test } from 'bun:test';
import type { ObjectKey } from '@repo/protocol';
import type { CommandRunner } from '#lib/exec.ts';
import { ZerofsTopology } from '#volumes/topology.ts';

const NO_EXIT_CODE = 0;
const HOST_PREFIX = 'filesystems/host-1' as ObjectKey;

const runner: CommandRunner = () => Promise.resolve({ code: NO_EXIT_CODE, stdout: '', stderr: '' });

const topology = () =>
  ZerofsTopology.sharedHostFilesystem({
    runner,
    storagePrefix: HOST_PREFIX,
    mountPath: '/mnt/zerofs',
    nbdSocketPath: '/run/zerofs/nbd.sock',
    binary: '/opt/nibrun/bin/zerofs/zerofs',
    configFile: '/etc/zerofs/config.toml',
  });

describe('the host decides where a volume goes', () => {
  test('a volume is placed in the filesystem this host serves', () => {
    const filesystem = topology().place();

    expect(filesystem.storagePrefix).toBe(HOST_PREFIX);
    expect(filesystem.mountPath).toBe('/mnt/zerofs');
    expect(filesystem.nbdSocketPath).toBe('/run/zerofs/nbd.sock');
    expect(filesystem.configFile).toBe('/etc/zerofs/config.toml');
  });

  test('placing twice lands in the same filesystem', () => {
    const host = topology();

    expect(host.place().storagePrefix).toBe(host.place().storagePrefix);
  });

  test('the whole set is enumerable, which is what a fleet-wide flush needs', () => {
    expect(
      topology()
        .all()
        .map((filesystem) => filesystem.storagePrefix),
    ).toEqual([HOST_PREFIX]);
  });
});

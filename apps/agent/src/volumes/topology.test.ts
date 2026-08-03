import { describe, expect, test } from 'bun:test';
import type { ObjectKey } from '@repo/protocol';
import type { CommandRunner } from '#lib/exec.ts';
import { UnservedStoragePrefixError, ZerofsTopology } from '#volumes/topology.ts';

const NO_EXIT_CODE = 0;
const HOST_PREFIX = 'filesystems/host-1' as ObjectKey;
const OTHER_PREFIX = 'filesystems/host-2' as ObjectKey;

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

describe('one ZeroFS per host', () => {
  test('every volume placed here resolves to the one filesystem', () => {
    const filesystem = topology().resolve({ storagePrefix: HOST_PREFIX });
    expect(filesystem.mountPath).toBe('/mnt/zerofs');
    expect(filesystem.nbdSocketPath).toBe('/run/zerofs/nbd.sock');
    expect(filesystem.configFile).toBe('/etc/zerofs/config.toml');
  });

  test('the whole set is enumerable, which is what a fleet-wide flush needs', () => {
    expect(
      topology()
        .all()
        .map((filesystem) => filesystem.storagePrefix),
    ).toEqual([HOST_PREFIX]);
  });
});

describe('a prefix this host does not serve', () => {
  test('is refused, never written to the filesystem that happens to be here', () => {
    expect(() => topology().resolve({ storagePrefix: OTHER_PREFIX })).toThrow(
      UnservedStoragePrefixError,
    );
  });

  test('the error names both what was asked for and what is served', () => {
    const error = (() => {
      try {
        topology().resolve({ storagePrefix: OTHER_PREFIX });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error?.message).toContain(OTHER_PREFIX);
    expect(error?.message).toContain(HOST_PREFIX);
  });
});

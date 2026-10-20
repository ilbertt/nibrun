import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, ObjectKeySchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { appZerofsFilesystem } from '#lib/volumes/app-zerofs-filesystem.ts';
import { agentConfig } from '#tests/support/config.ts';
import { APP_ID } from '#tests/support/fixtures.ts';

const STORAGE_PREFIX = Value.Parse(ObjectKeySchema, 'customer/filesystem');
const BINARY = '/opt/test/zerofs';

function filesystem(appId: AppId) {
  return Effect.runSync(
    appZerofsFilesystem({ appId, storagePrefix: STORAGE_PREFIX }).pipe(
      Effect.provide(agentConfig({ stateDir: '/var/lib/nibrun', zerofsBinary: BINARY })),
    ),
  );
}

describe('per-app live filesystem endpoints', () => {
  test('uses the app prefix, mount, socket and private admin config', () => {
    expect(filesystem(APP_ID)).toEqual({
      storagePrefix: STORAGE_PREFIX,
      mountPath: '/mnt/zerofs-apps/app-1',
      nbdSocketPath: '/run/zerofs-apps/app-1/nbd.sock',
      admin: { binary: BINARY, configFile: '/var/lib/nibrun/zerofs/app-1/config.toml' },
    });
  });

  test('equal relative prefixes still have app-specific host endpoints', () => {
    const first = filesystem(APP_ID);
    const second = filesystem(Value.Parse(AppIdSchema, 'app-2'));
    expect(first.storagePrefix).toBe(second.storagePrefix);
    expect(first.mountPath).not.toBe(second.mountPath);
    expect(first.nbdSocketPath).not.toBe(second.nbdSocketPath);
    expect(first.admin.configFile).not.toBe(second.admin.configFile);
  });
});

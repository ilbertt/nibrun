import { expect, test } from 'bun:test';
import { MIN_IDLE_TIMEOUT_MS } from '@repo/protocol';
import { interpolableRuntimeValue, RUNTIME_VALUES } from '@repo/protocol/runtime-values';
import { UnsupportedNibrunnerFeature } from '#lib/nibrunner/failure.ts';
import { nibrunnerInstance } from '#lib/nibrunner/instance.ts';
import { APP_HOSTNAME, desiredInstance, tenantEnvironment } from '#tests/support/fixtures.ts';

const DATA_REFERENCE = interpolableRuntimeValue(RUNTIME_VALUES.DATA_DIR.name);
const HOSTNAME_REFERENCE = interpolableRuntimeValue(RUNTIME_VALUES.HOSTNAME.name);
const HTTP_REFERENCE = interpolableRuntimeValue(RUNTIME_VALUES.HTTP_PORT.name);

test('an executable keeps its identity, argv, working directory and health policy', () => {
  const instance = desiredInstance();
  instance.config.args = ['serve', '--name=a b', '$(literal)', '"quoted"'];
  instance.hostnames = [APP_HOSTNAME];
  const converted = nibrunnerInstance(instance);
  expect(converted.layers).toEqual([
    {
      kind: 'executable',
      destinationPath: '/mnt/artifact/server',
      digest: instance.artifact.digest,
      objectKey: instance.artifact.digest,
    },
  ]);
  expect(converted.config.command.program).toBe('/mnt/artifact/server');
  expect(converted.config.command.workingDirectory).toBe('/app');
  expect(converted.config.command.args).toEqual(instance.config.args);
  expect(converted.config.healthCheck).toEqual({ kind: 'tcp', ...instance.config.healthCheck });
  expect(converted.config.resources).toEqual(instance.config.resources);
  expect(converted.config.restartPolicy).toEqual(instance.config.restartPolicy);
  expect(converted.hostnames).toEqual(instance.hostnames);
  expect(converted.access).toEqual({ kind: 'public' });
  expect(converted.appId).toBe(instance.appId);
  expect(converted.deploymentId).toBe(instance.deploymentId);
  expect(converted.volumeId).toBe(instance.volumeId);
});

test('HTTP health checks and on-request timing are preserved', () => {
  const instance = desiredInstance({
    desiredState: 'on-request',
    idleTimeoutMs: MIN_IDLE_TIMEOUT_MS,
  });
  instance.config.healthCheck = { ...instance.config.healthCheck, path: '/ready' };
  const converted = nibrunnerInstance(instance);
  expect(converted.config.healthCheck).toEqual({
    kind: 'http',
    ...instance.config.healthCheck,
    path: '/ready',
  });
  expect(converted.desiredState).toBe('on-request');
  expect(converted.idleTimeoutMs).toBe(MIN_IDLE_TIMEOUT_MS);
  expect(nibrunnerInstance(desiredInstance({ desiredState: 'stopped' })).desiredState).toBe(
    'stopped',
  );
});

test('data references resolve while hostname and HTTP references reach the engine unchanged', () => {
  const instance = desiredInstance();
  instance.config.environment = tenantEnvironment({
    DATABASE: `${DATA_REFERENCE}/db.sqlite`,
    URL: `https://${HOSTNAME_REFERENCE}:${HTTP_REFERENCE}`,
    LITERAL: '$NIBRUN_DATA_DIR ${NIBRUN_DATA_DIR',
    NIBRUN_DATA_DIR: '/override',
    NIBRUN_HOSTNAME: 'wrong.example.com',
    NIBRUN_PUBLIC_IPV4: '192.0.2.1',
  });
  expect(nibrunnerInstance(instance).config.command.environment).toEqual(
    tenantEnvironment({
      DATABASE: '/app/data/db.sqlite',
      URL: `https://${HOSTNAME_REFERENCE}:${HTTP_REFERENCE}`,
      LITERAL: '$NIBRUN_DATA_DIR ${NIBRUN_DATA_DIR',
      NIBRUN_DATA_DIR: '/app/data',
    }),
  );
});

test('public ports and their references are refused without exposing tenant values', () => {
  const instance = desiredInstance();
  instance.config.hasExtraPublicPort = true;
  expect(function translatePort() {
    nibrunnerInstance(instance);
  }).toThrow(UnsupportedNibrunnerFeature);
  instance.config.hasExtraPublicPort = false;
  instance.config.environment = tenantEnvironment({ SECRET: `sensitive-${interpolableRuntimeValue(RUNTIME_VALUES.PUBLIC_IPV4.name)}` });
  expect(function translateReference() {
    nibrunnerInstance(instance);
  }).toThrow('public port references');
  try {
    nibrunnerInstance(instance);
  } catch (error) {
    expect(String(error)).not.toContain('sensitive');
  }
});

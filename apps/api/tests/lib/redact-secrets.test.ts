import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  DeploymentIdSchema,
  ExportIdSchema,
  FilenameSchema,
  type HostDesiredState,
  HostDesiredStateSchema,
  HostIdSchema,
  HostnameSchema,
  ObjectKeySchema,
  SecretStringSchema,
  Sha256DigestSchema,
  Value,
  VolumeIdSchema,
} from '@repo/protocol';
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
} from '#lib/app-config-defaults.ts';
import { REDACTED, redactSecrets } from '#lib/redact-secrets.ts';

const TENANT_SECRET = Value.Parse(SecretStringSchema, 'sk-live-do-not-log-this');

const SHA256_HEX_LENGTH = 64;

function hexDigest(length: number = SHA256_HEX_LENGTH) {
  return 'a'.repeat(length);
}

function desiredState(): HostDesiredState {
  return {
    hostId: Value.Parse(HostIdSchema, 'host_1'),
    volumes: [
      {
        volumeId: Value.Parse(VolumeIdSchema, 'vol_1'),
        appId: Value.Parse(AppIdSchema, 'app_1'),
        sizeBytes: 1024,
        desiredState: 'present',
      },
    ],
    instances: [
      {
        appId: Value.Parse(AppIdSchema, 'app_1'),
        deploymentId: Value.Parse(DeploymentIdSchema, 'dep_1'),
        volumeId: Value.Parse(VolumeIdSchema, 'vol_1'),
        desiredState: 'running',
        artifact: {
          digest: Value.Parse(Sha256DigestSchema, hexDigest()),
          sizeBytes: 2048,
          objectKey: Value.Parse(ObjectKeySchema, 'artifacts/app_1/a'),
          filename: Value.Parse(FilenameSchema, 'server'),
        },
        config: {
          httpPort: DEFAULT_HTTP_PORT,
          hasExtraPublicPort: true,
          args: ['serve', '--http=0.0.0.0:8090'],
          environment: { DATABASE_URL: TENANT_SECRET },
          resources: DEFAULT_INSTANCE_RESOURCES,
          healthCheck: DEFAULT_HEALTH_CHECK,
          restartPolicy: DEFAULT_RESTART_POLICY,
        },
        hostnames: [
          { hostname: Value.Parse(HostnameSchema, 'app-1.nibrun.app'), kind: 'platform' },
        ],
      },
    ],
    checkpoints: [],
    exports: [],
  };
}

function desiredExport() {
  return {
    exportId: Value.Parse(ExportIdSchema, 'exp_1'),
    appId: Value.Parse(AppIdSchema, 'app_1'),
    volumeId: Value.Parse(VolumeIdSchema, 'vol_1'),
    objectKey: Value.Parse(ObjectKeySchema, 'exports/app_1/exp_1.tar.gz'),
    artifact: {
      digest: hexDigest(),
      sizeBytes: 2048,
      objectKey: Value.Parse(ObjectKeySchema, 'artifacts/app_1/a'),
      filename: Value.Parse(FilenameSchema, 'server'),
    },
    environment: { API_KEY: TENANT_SECRET },
    desiredState: 'present',
  };
}

// The moment an owner most wants their data out is after they have stopped the app, and a
// stopped app puts no instance in desired state. The export naming its own binary is what
// keeps the bundle writable then.

describe('secrets', () => {
  test('redaction reaches tenant environment values anywhere in a message', () => {
    const redacted = redactSecrets({ schema: HostDesiredStateSchema, value: desiredState() });
    expect(JSON.stringify(redacted)).not.toInclude(TENANT_SECRET);
    expect(JSON.stringify(redacted)).toInclude(REDACTED);
  });

  // A second place tenant values cross the wire, so a message carrying an export has to be as
  // safe to log as one carrying an instance.
  test('redaction reaches the environment an export carries', () => {
    const redacted = redactSecrets({
      schema: HostDesiredStateSchema,
      value: { ...desiredState(), instances: [], exports: [desiredExport()] },
    });

    expect(JSON.stringify(redacted)).not.toInclude(TENANT_SECRET);
    expect(JSON.stringify(redacted)).toInclude(REDACTED);
  });

  test('redaction leaves everything else alone', () => {
    const redacted = redactSecrets({
      schema: HostDesiredStateSchema,
      value: desiredState(),
    }) as HostDesiredState;
    expect(redacted.hostId).toBe(desiredState().hostId);
    expect(redacted.instances[0]?.hostnames[0]?.hostname).toBe(
      Value.Parse(HostnameSchema, 'app-1.nibrun.app'),
    );
  });
});

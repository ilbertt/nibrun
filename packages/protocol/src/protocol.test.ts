import { describe, expect, test } from 'bun:test';
import {
  type AppId,
  AppIdSchema,
  DEFAULT_AGENT_POLL_SETTINGS,
  DEFAULT_GUEST_PORT,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  type DeploymentId,
  DesiredStateResponseSchema,
  type GuestPort,
  type HostDesiredState,
  HostDesiredStateSchema,
  type HostId,
  type Hostname,
  type HostPort,
  type InstanceId,
  isValidMessage,
  type ObjectKey,
  ProtocolValidationError,
  parseMessage,
  REDACTED,
  redactSecrets,
  type SecretString,
  Sha256DigestSchema,
  type Timestamp,
  TimestampSchema,
  type VolumeId,
} from '#index.ts';
import { GuestPortSchema, HostPortSchema } from '#lib/wire.ts';

const TENANT_SECRET = 'sk-live-do-not-log-this' as SecretString;

const SHA256_HEX_LENGTH = 64;
const TRUNCATED_DIGEST_LENGTH = SHA256_HEX_LENGTH - 1;
const OVERLONG_SECRET_LENGTH = 40_000;

const hexDigest = (length: number = SHA256_HEX_LENGTH) => 'a'.repeat(length);

const desiredState = (): HostDesiredState => ({
  hostId: 'host_1' as HostId,
  generation: 7,
  volumes: [
    {
      volumeId: 'vol_1' as VolumeId,
      appId: 'app_1' as AppId,
      sizeBytes: 1024,
      storagePrefix: 'filesystems/app_1' as ObjectKey,
      desiredState: 'present',
    },
  ],
  instances: [
    {
      instanceId: 'inst_1' as InstanceId,
      appId: 'app_1' as AppId,
      deploymentId: 'dep_1' as DeploymentId,
      volumeId: 'vol_1' as VolumeId,
      desiredState: 'running',
      artifact: {
        digest: hexDigest() as never,
        sizeBytes: 2048,
        objectKey: 'artifacts/app_1/a' as ObjectKey,
      },
      config: {
        guestPort: DEFAULT_GUEST_PORT,
        environment: { DATABASE_URL: TENANT_SECRET },
        resources: DEFAULT_INSTANCE_RESOURCES,
        healthCheck: DEFAULT_HEALTH_CHECK,
        restartPolicy: DEFAULT_RESTART_POLICY,
      },
      hostnames: [{ hostname: 'app-1.nibrun.app' as Hostname, kind: 'platform', isDefault: true }],
    },
  ],
  checkpoints: [],
  exports: [],
});

// Branding a schema means overriding a type-level property on it. If that ever started
// rewriting the runtime schema instead, every branded field would silently accept anything —
// which is exactly the failure this package exists to prevent.
describe('branding leaves runtime validation intact', () => {
  test('identifiers still reject malformed values', () => {
    expect(isValidMessage({ schema: AppIdSchema, value: 'app_1' })).toBe(true);
    expect(isValidMessage({ schema: AppIdSchema, value: 'has space' })).toBe(false);
    expect(isValidMessage({ schema: AppIdSchema, value: '' })).toBe(false);
    expect(isValidMessage({ schema: AppIdSchema, value: 42 })).toBe(false);
  });

  test('digests still reject anything that is not lowercase hex of the right length', () => {
    expect(isValidMessage({ schema: Sha256DigestSchema, value: hexDigest() })).toBe(true);
    expect(isValidMessage({ schema: Sha256DigestSchema, value: hexDigest().toUpperCase() })).toBe(
      false,
    );
    expect(
      isValidMessage({ schema: Sha256DigestSchema, value: hexDigest(TRUNCATED_DIGEST_LENGTH) }),
    ).toBe(false);
    expect(isValidMessage({ schema: Sha256DigestSchema, value: `sha256:${hexDigest()}` })).toBe(
      false,
    );
  });

  test('ports still reject out-of-range numbers', () => {
    expect(isValidMessage({ schema: GuestPortSchema, value: 3000 })).toBe(true);
    expect(isValidMessage({ schema: GuestPortSchema, value: 0 })).toBe(false);
    expect(isValidMessage({ schema: GuestPortSchema, value: 65_536 })).toBe(false);
    expect(isValidMessage({ schema: GuestPortSchema, value: 3000.5 })).toBe(false);
  });
});

test('a guest port cannot be used where a host port belongs', () => {
  const guestPort: GuestPort = DEFAULT_GUEST_PORT;
  // @ts-expect-error the two ports mean different things and are branded apart
  const hostPort: HostPort = guestPort;
  expect(isValidMessage({ schema: HostPortSchema, value: hostPort })).toBe(true);
});

test('state unions narrow to their literals rather than widening to string', () => {
  const state = desiredState();
  const instance = state.instances[0];
  if (!instance) {
    throw new Error('fixture lost its instance');
  }
  // @ts-expect-error 'halted' is not one of the desired instance states
  instance.desiredState = 'halted';
  expect(isValidMessage({ schema: HostDesiredStateSchema, value: state })).toBe(false);
});

describe('timestamps', () => {
  test('accept an ISO instant carrying an offset', () => {
    expect(isValidMessage({ schema: TimestampSchema, value: '2026-08-03T09:41:00Z' })).toBe(true);
    expect(
      isValidMessage({ schema: TimestampSchema, value: '2026-08-03T09:41:00.123+02:00' }),
    ).toBe(true);
  });

  test('reject the shapes that silently become a wrong instant', () => {
    expect(isValidMessage({ schema: TimestampSchema, value: '2026-08-03T09:41:00' })).toBe(false);
    expect(isValidMessage({ schema: TimestampSchema, value: '2026-08-03' })).toBe(false);
    expect(isValidMessage({ schema: TimestampSchema, value: 1_754_213_260_000 })).toBe(false);
  });
});

describe('version skew', () => {
  test('a field the older side has never heard of is tolerated', () => {
    const withFutureField = { ...desiredState(), somethingAddedLater: { nested: true } };
    expect(() =>
      parseMessage({ schema: HostDesiredStateSchema, value: withFutureField }),
    ).not.toThrow();
  });

  test('a missing required field is rejected', () => {
    const { generation: _generation, ...withoutGeneration } = desiredState();
    expect(() =>
      parseMessage({ schema: HostDesiredStateSchema, value: withoutGeneration }),
    ).toThrow(ProtocolValidationError);
  });

  test('the desired-state response discriminates on its result', () => {
    expect(
      isValidMessage({
        schema: DesiredStateResponseSchema,
        value: { result: 'unchanged', generation: 7 },
      }),
    ).toBe(true);
    expect(
      isValidMessage({
        schema: DesiredStateResponseSchema,
        value: { result: 'changed', generation: 7 },
      }),
    ).toBe(false);
    expect(
      isValidMessage({
        schema: DesiredStateResponseSchema,
        value: { result: 'changed', state: desiredState() },
      }),
    ).toBe(true);
  });
});

describe('secrets', () => {
  test('redaction reaches tenant environment values anywhere in a message', () => {
    const redacted = redactSecrets({ schema: HostDesiredStateSchema, value: desiredState() });
    expect(JSON.stringify(redacted)).not.toInclude(TENANT_SECRET);
    expect(JSON.stringify(redacted)).toInclude(REDACTED);
  });

  test('redaction leaves everything else alone', () => {
    const redacted = redactSecrets({
      schema: HostDesiredStateSchema,
      value: desiredState(),
    }) as HostDesiredState;
    expect(redacted.generation).toBe(desiredState().generation);
    expect(redacted.instances[0]?.hostnames[0]?.hostname).toBe('app-1.nibrun.app' as Hostname);
  });

  test('a validation failure never carries the offending value into its message', () => {
    const state = desiredState();
    const overlong = 'x'.repeat(OVERLONG_SECRET_LENGTH) as SecretString;
    const instance = state.instances[0];
    if (!instance) {
      throw new Error('fixture lost its instance');
    }
    instance.config.environment = { API_KEY: overlong };

    try {
      parseMessage({ schema: HostDesiredStateSchema, value: state });
      throw new Error('expected the overlong secret to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolValidationError);
      expect((error as ProtocolValidationError).message).not.toInclude(overlong);
      expect(JSON.stringify((error as ProtocolValidationError).issues)).not.toInclude(overlong);
    }
  });
});

test('a fully populated desired state round-trips through JSON', () => {
  const parsed = parseMessage({
    schema: HostDesiredStateSchema,
    value: JSON.parse(JSON.stringify(desiredState())),
  });
  expect(parsed).toEqual(desiredState());
});

test('the poll settings the control plane hands out are themselves valid', () => {
  expect(DEFAULT_AGENT_POLL_SETTINGS.maxWaitSeconds).toBeGreaterThan(0);
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeLessThan(
    DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs,
  );
});

test('a timestamp brand still requires a cast from a plain string', () => {
  const now = new Date().toISOString() as Timestamp;
  expect(isValidMessage({ schema: TimestampSchema, value: now })).toBe(true);
});

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
  DIRECTORY_ENTRY_LIMIT,
  DirectoryListingSchema,
  type ExportId,
  type Filename,
  FilesystemEntryNameSchema,
  GuestPathSchema,
  type GuestPort,
  type HostDesiredState,
  HostDesiredStateSchema,
  type HostId,
  type Hostname,
  type HostPort,
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
import { FilenameSchema, GuestPortSchema, HostPortSchema } from '#lib/wire.ts';

const TENANT_SECRET = 'sk-live-do-not-log-this' as SecretString;

const SHA256_HEX_LENGTH = 64;
const TRUNCATED_DIGEST_LENGTH = SHA256_HEX_LENGTH - 1;
const OVERLONG_SECRET_LENGTH = 40_000;
/** One past what ext4 itself stores, so the schema and the filesystem agree on the boundary. */
const OVERLONG_ENTRY_NAME_LENGTH = 256;

const hexDigest = (length: number = SHA256_HEX_LENGTH) => 'a'.repeat(length);

const desiredState = (): HostDesiredState => ({
  hostId: 'host_1' as HostId,
  volumes: [
    {
      volumeId: 'vol_1' as VolumeId,
      appId: 'app_1' as AppId,
      sizeBytes: 1024,
      desiredState: 'present',
    },
  ],
  instances: [
    {
      appId: 'app_1' as AppId,
      deploymentId: 'dep_1' as DeploymentId,
      volumeId: 'vol_1' as VolumeId,
      desiredState: 'running',
      artifact: {
        digest: hexDigest() as never,
        sizeBytes: 2048,
        objectKey: 'artifacts/app_1/a' as ObjectKey,
        filename: 'server' as Filename,
      },
      config: {
        guestPort: DEFAULT_GUEST_PORT,
        args: ['serve', '--http=0.0.0.0:8090'],
        environment: { DATABASE_URL: TENANT_SECRET },
        resources: DEFAULT_INSTANCE_RESOURCES,
        healthCheck: DEFAULT_HEALTH_CHECK,
        restartPolicy: DEFAULT_RESTART_POLICY,
      },
      hostnames: [{ hostname: 'app-1.nibrun.app' as Hostname, kind: 'platform' }],
    },
  ],
  checkpoints: [],
  exports: [],
});

const desiredExport = () => ({
  exportId: 'exp_1' as ExportId,
  appId: 'app_1' as AppId,
  volumeId: 'vol_1' as VolumeId,
  objectKey: 'exports/app_1/exp_1.tar.gz' as ObjectKey,
  artifact: {
    digest: hexDigest(),
    sizeBytes: 2048,
    objectKey: 'artifacts/app_1/a' as ObjectKey,
    filename: 'server' as Filename,
  },
  desiredState: 'present',
});

// The moment an owner most wants their data out is after they have stopped the app, and a
// stopped app puts no instance in desired state. The export naming its own binary is what
// keeps the bundle writable then.
describe('an export names the binary it packages', () => {
  test('a host running nothing is still told how to write one', () => {
    const stopped = { ...desiredState(), instances: [], exports: [desiredExport()] };

    expect(isValidMessage({ schema: HostDesiredStateSchema, value: stopped })).toBe(true);
  });

  test('an export that names no binary is not one', () => {
    const { artifact: _artifact, ...unnamed } = desiredExport();

    expect(
      isValidMessage({
        schema: HostDesiredStateSchema,
        value: { ...desiredState(), exports: [unnamed] },
      }),
    ).toBe(false);
  });
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

  // A filename crosses the wire from whoever uploaded the binary and becomes a path inside an
  // archive someone extracts, so anything that is not a single segment is refused here first.
  test('a filename is one path segment and never a path', () => {
    expect(isValidMessage({ schema: FilenameSchema, value: 'pocketbase' })).toBe(true);
    expect(isValidMessage({ schema: FilenameSchema, value: 'pb-0.39.10_linux-amd64' })).toBe(true);
    expect(isValidMessage({ schema: FilenameSchema, value: '../escape' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: 'nested/path' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: '..' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: '.hidden' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: '-rf' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: 'nul\u0000byte' })).toBe(false);
    expect(isValidMessage({ schema: FilenameSchema, value: '' })).toBe(false);
  });
});

// A name is reported and a path is accepted, so they are validated in opposite directions. The
// pair of suites below exist to keep that asymmetry deliberate: loosening the path or tightening
// the name would each look like a small consistency fix in isolation.
describe('a directory entry name describes what the tenant created', () => {
  const accepts = (value: string) => isValidMessage({ schema: FilesystemEntryNameSchema, value });

  test('anything ext4 stores survives being described', () => {
    expect(accepts('pb_data')).toBe(true);
    expect(accepts('.env')).toBe(true);
    expect(accepts('-rf')).toBe(true);
    expect(accepts("it's")).toBe(true);
    expect(accepts('a b c.txt')).toBe(true);
    expect(accepts('données.txt')).toBe(true);
    expect(accepts('..')).toBe(true);
  });

  test('only what ext4 itself cannot hold is refused', () => {
    expect(accepts('nested/path')).toBe(false);
    expect(accepts('nul\u0000byte')).toBe(false);
    expect(accepts('')).toBe(false);
    expect(accepts('n'.repeat(OVERLONG_ENTRY_NAME_LENGTH))).toBe(false);
  });
});

describe('a guest path is accepted rather than described', () => {
  const accepts = (value: string) => isValidMessage({ schema: GuestPathSchema, value });

  test('an absolute path inside the volume is addressable', () => {
    expect(accepts('/')).toBe(true);
    expect(accepts('/pb_data')).toBe(true);
    expect(accepts('/pb_data/backups')).toBe(true);
    expect(accepts('/.env')).toBe(true);
    expect(accepts('/a b c')).toBe(true);
  });

  test('nothing that resolves out of the volume is', () => {
    expect(accepts('/..')).toBe(false);
    expect(accepts('/pb_data/../../etc')).toBe(false);
    expect(accepts('/.')).toBe(false);
    expect(accepts('/pb_data/.')).toBe(false);
    expect(accepts('pb_data')).toBe(false);
  });

  // The value reaches `debugfs -R`, which tokenises its argument the way a shell would, so a
  // second command must not be expressible in it.
  test('nothing that could carry a second command is', () => {
    expect(accepts('/pb_data" -R "rm /pb_data')).toBe(false);
    expect(accepts("/pb_data' -R 'rm /pb_data")).toBe(false);
    expect(accepts('/pb_data\\backups')).toBe(false);
    expect(accepts('/pb_data\nrm /')).toBe(false);
    expect(accepts('/nul\u0000byte')).toBe(false);
  });

  // A trailing slash and a doubled separator both name the same directory as the canonical form,
  // so admitting them would make one directory two cache keys and two audit-log lines.
  test('only the canonical spelling of a directory is', () => {
    expect(accepts('/pb_data/')).toBe(false);
    expect(accepts('//pb_data')).toBe(false);
    expect(accepts('/pb_data//backups')).toBe(false);
  });
});

test('a listing carries one flat directory and says when it held back', () => {
  const entry = {
    name: 'data.db',
    kind: 'file',
    sizeBytes: 4096,
    modifiedAt: '2026-08-03T09:41:00Z',
  };
  expect(
    isValidMessage({
      schema: DirectoryListingSchema,
      value: { path: '/pb_data', entries: [entry], truncated: false },
    }),
  ).toBe(true);
  expect(
    isValidMessage({
      schema: DirectoryListingSchema,
      value: {
        path: '/pb_data',
        entries: Array.from({ length: DIRECTORY_ENTRY_LIMIT + 1 }, () => entry),
        truncated: true,
      },
    }),
  ).toBe(false);
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
    const { hostId: _hostId, ...withoutHostId } = desiredState();
    expect(() => parseMessage({ schema: HostDesiredStateSchema, value: withoutHostId })).toThrow(
      ProtocolValidationError,
    );
  });

  // The whole of it, with nothing wrapped around it saying whether it moved: a host compares it
  // with what it holds, so there is no second shape the reply can take.
  test('the desired-state reply is the state itself', () => {
    expect(isValidMessage({ schema: DesiredStateResponseSchema, value: desiredState() })).toBe(
      true,
    );
    expect(
      isValidMessage({
        schema: DesiredStateResponseSchema,
        value: { result: 'unchanged', generation: 7 },
      }),
    ).toBe(false);
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
    expect(redacted.hostId).toBe(desiredState().hostId);
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
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeGreaterThan(0);
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeLessThan(
    DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs,
  );
});

test('a timestamp brand still requires a cast from a plain string', () => {
  const now = new Date().toISOString() as Timestamp;
  expect(isValidMessage({ schema: TimestampSchema, value: now })).toBe(true);
});

import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  DeploymentIdSchema,
  DesiredStateResponseSchema,
  DIRECTORY_ENTRY_LIMIT,
  DirectoryListingSchema,
  ExportIdSchema,
  FilesystemEntryNameSchema,
  GuestPathSchema,
  type HostDesiredState,
  HostDesiredStateSchema,
  HostIdSchema,
  HostnameSchema,
  type HostPort,
  type HttpPort,
  IdleTimeoutMsSchema,
  isValidMessage,
  MAX_IDLE_TIMEOUT_MS,
  MIN_IDLE_TIMEOUT_MS,
  ObjectKeySchema,
  ProtocolValidationError,
  parseMessage,
  type SecretString,
  SecretStringSchema,
  Sha256DigestSchema,
  TimestampSchema,
  Value,
  VolumeIdSchema,
} from '#index.ts';
import { FilenameSchema, HostPortSchema, HttpPortSchema } from '#lib/wire.ts';

const HTTP_PORT_NUMBER = 3000;
const HTTP_PORT_FIXTURE = Value.Parse(HttpPortSchema, HTTP_PORT_NUMBER);
const HEALTH_CHECK_FIXTURE = {
  intervalMs: 5000,
  timeoutMs: 2000,
  gracePeriodMs: 30000,
  healthyThreshold: 1,
  unhealthyThreshold: 3,
};
const RESOURCES_FIXTURE = { vcpuCount: 1, memoryMib: 256 };
const RESTART_POLICY_FIXTURE = {
  maxRestarts: 5,
  initialBackoffMs: 500,
  maxBackoffMs: 30000,
  backoffFactor: 2,
  resetAfterMs: 60000,
};

const TENANT_SECRET = Value.Parse(SecretStringSchema, 'sk-live-do-not-log-this');

const SHA256_HEX_LENGTH = 64;
const TRUNCATED_DIGEST_LENGTH = SHA256_HEX_LENGTH - 1;
const OVERLONG_SECRET_LENGTH = 40_000;
/** One past what ext4 itself stores, so the schema and the filesystem agree on the boundary. */
const OVERLONG_ENTRY_NAME_LENGTH = 256;

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
          digest: hexDigest() as never,
          sizeBytes: 2048,
          objectKey: Value.Parse(ObjectKeySchema, 'artifacts/app_1/a'),
          filename: Value.Parse(FilenameSchema, 'server'),
        },
        config: {
          httpPort: HTTP_PORT_FIXTURE,
          hasExtraPublicPort: true,
          args: ['serve', '--http=0.0.0.0:8090'],
          environment: { DATABASE_URL: TENANT_SECRET },
          resources: RESOURCES_FIXTURE,
          healthCheck: HEALTH_CHECK_FIXTURE,
          restartPolicy: RESTART_POLICY_FIXTURE,
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

  /**
   * The environment is the other half of what makes a bundle runnable, and it is optional exactly
   * so this stays true: a control plane that predates the field, or one that cannot say what an
   * export was configured with, still sends state a host can act on. Were it required, an agent
   * deployed an hour before the api would reject the whole reply — every instance and every volume
   * with it — over a field about one bundle's `.env`.
   */
  test('an export that names no environment is still one', () => {
    const { environment: _environment, ...unconfigured } = desiredExport();

    expect(
      isValidMessage({
        schema: HostDesiredStateSchema,
        value: { ...desiredState(), exports: [unconfigured] },
      }),
    ).toBe(true);
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
    expect(isValidMessage({ schema: HttpPortSchema, value: 3000 })).toBe(true);
    expect(isValidMessage({ schema: HttpPortSchema, value: 0 })).toBe(false);
    expect(isValidMessage({ schema: HttpPortSchema, value: 65_536 })).toBe(false);
    expect(isValidMessage({ schema: HttpPortSchema, value: 3000.5 })).toBe(false);
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
  function accepts(value: string) {
    return isValidMessage({ schema: FilesystemEntryNameSchema, value });
  }

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
  function accepts(value: string) {
    return isValidMessage({ schema: GuestPathSchema, value });
  }

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

test('an HTTP port cannot be used where a host port belongs', () => {
  const httpPort: HttpPort = HTTP_PORT_FIXTURE;
  // @ts-expect-error the two ports mean different things and are branded apart
  const hostPort: HostPort = httpPort;
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

/**
 * An environment travels from the api to a host as a JavaScript object, and `object.__proto__ = x`
 * sets a prototype rather than a property: a variable by that name would be accepted, stored, and
 * then be quietly missing from everything that read it back. The schema is where an owner is told
 * instead, and `nibrun.app_config_environment` says the same thing in SQL.
 */
describe('secret validation', () => {
  test('desired state validates runtime references before the guest receives them', () => {
    const state = desiredState();
    const instance = state.instances[0]!;
    instance.config.environment = {
      CALLBACK_URL: Value.Parse(SecretStringSchema, `https://\${NIBRUN_HOSTNAME}/callback`),
    };
    expect(isValidMessage({ schema: HostDesiredStateSchema, value: state })).toBe(true);

    instance.config.environment = {
      CALLBACK_URL: Value.Parse(SecretStringSchema, `https://\${NIBRUN_HSOTNAME}/callback`),
    };
    expect(isValidMessage({ schema: HostDesiredStateSchema, value: state })).toBe(false);
  });

  test('a validation failure never carries the offending value into its message', () => {
    const state = desiredState();
    // Cast rather than parsed: the value has to violate the schema for the rejection this test
    // is about to happen at all, so constructing it through the schema would defeat the test.
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

test('a timestamp brand is only obtained by parsing a plain string', () => {
  const now = Value.Parse(TimestampSchema, new Date().toISOString());
  expect(isValidMessage({ schema: TimestampSchema, value: now })).toBe(true);
});

describe('how long an app may wait before it sleeps', () => {
  function accepts(value: number) {
    return isValidMessage({ schema: IdleTimeoutMsSchema, value });
  }

  // The floor is the cadence the host measures traffic on, so anything under it is a promise
  // the host cannot keep rather than an aggressive setting.
  test('below the measurement tick is refused', () => {
    expect(accepts(MIN_IDLE_TIMEOUT_MS)).toBe(true);
    expect(accepts(MIN_IDLE_TIMEOUT_MS - 1)).toBe(false);
  });

  // The ceiling is not a view about how long is sensible — `always` is how an owner says never
  // sleep. It only catches the slipped zero, so it has to accept every wait somebody could mean.
  test('a day is accepted and a typo past it is not', () => {
    expect(accepts(MAX_IDLE_TIMEOUT_MS)).toBe(true);
    expect(accepts(MAX_IDLE_TIMEOUT_MS + 1)).toBe(false);
  });

  test('the hours an app visited twice a day would want are legal', () => {
    const sixHours = 21_600_000;
    expect(accepts(sixHours)).toBe(true);
  });
});

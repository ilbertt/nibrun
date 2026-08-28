import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  DEFAULT_AGENT_POLL_SETTINGS,
  DEFAULT_HEALTH_CHECK,
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
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
  isValidMessage,
  namesExtraPublicPortValues,
  ObjectKeySchema,
  ProtocolValidationError,
  parseMessage,
  REDACTED,
  redactSecrets,
  type SecretString,
  SecretStringSchema,
  SeenTenantLogs,
  Sha256DigestSchema,
  TenantEnvironmentPatchSchema,
  TenantEnvironmentSchema,
  type TenantLogRecord,
  TimestampSchema,
  Value,
  VolumeIdSchema,
} from '#index.ts';
import { FilenameSchema, HostPortSchema, HttpPortSchema } from '#lib/wire.ts';

const TENANT_SECRET = Value.Parse(SecretStringSchema, 'sk-live-do-not-log-this');

const SHA256_HEX_LENGTH = 64;
const TRUNCATED_DIGEST_LENGTH = SHA256_HEX_LENGTH - 1;
const OVERLONG_SECRET_LENGTH = 40_000;
/** One past what ext4 itself stores, so the schema and the filesystem agree on the boundary. */
const OVERLONG_ENTRY_NAME_LENGTH = 256;

const hexDigest = (length: number = SHA256_HEX_LENGTH) => 'a'.repeat(length);

const desiredState = (): HostDesiredState => ({
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
        httpPort: DEFAULT_HTTP_PORT,
        hasExtraPublicPort: true,
        args: ['serve', '--http=0.0.0.0:8090'],
        environment: { DATABASE_URL: TENANT_SECRET },
        resources: DEFAULT_INSTANCE_RESOURCES,
        healthCheck: DEFAULT_HEALTH_CHECK,
        restartPolicy: DEFAULT_RESTART_POLICY,
      },
      hostnames: [{ hostname: Value.Parse(HostnameSchema, 'app-1.nibrun.app'), kind: 'platform' }],
    },
  ],
  checkpoints: [],
  exports: [],
});

const desiredExport = () => ({
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

test('an HTTP port cannot be used where a host port belongs', () => {
  const httpPort: HttpPort = DEFAULT_HTTP_PORT;
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
describe('a variable named __proto__ is not one', () => {
  // Built with fromEntries rather than a literal, which is the one way to give a plain object that
  // key as a property at all — and the shape the api would receive from JSON.parse.
  const named = (name: string) => Object.fromEntries([[name, TENANT_SECRET]]);

  test('setting one is refused', () => {
    expect(isValidMessage({ schema: TenantEnvironmentSchema, value: named('__proto__') })).toBe(
      false,
    );
  });

  test('so is an edit that names one', () => {
    expect(
      isValidMessage({ schema: TenantEnvironmentPatchSchema, value: named('__proto__') }),
    ).toBe(false);
  });

  test('a name that merely starts with it is a name like any other', () => {
    expect(isValidMessage({ schema: TenantEnvironmentSchema, value: named('__proto__x') })).toBe(
      true,
    );
    expect(isValidMessage({ schema: TenantEnvironmentSchema, value: named('_PROTO_') })).toBe(true);
  });
});

/**
 * A tenant value may name a runtime value the guest sets, and apps/runtime fails the boot over a
 * name it does not offer. The schema is what turns a typo into a deploy nobody accepted, which is
 * the only end of this where whoever wrote it is still listening.
 */
describe('a value naming a runtime value', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
  const OFFERED = '${NIBRUN_HOSTNAME}';
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
  const MISSPELLED = '${NIBRUN_HSOTNAME}';

  function holding(value: string) {
    return { CALLBACK_URL: value };
  }

  function accepts(value: string) {
    return isValidMessage({ schema: TenantEnvironmentSchema, value: holding(value) });
  }

  test('both forms the guest expands are accepted', () => {
    expect(accepts(`https://${OFFERED}/callback`)).toBe(true);
    expect(accepts('$NIBRUN_HTTP_PORT')).toBe(true);
  });

  test('a name the guest does not offer is refused', () => {
    expect(accepts(`https://${MISSPELLED}/callback`)).toBe(false);
    expect(accepts('$NIBRUN_HTTP_PORTS')).toBe(false);
  });

  // The guest reads a name to its last name character, so this one is NIBRUN_HOSTNAME with no
  // closing brace rather than the value someone meant.
  test('a brace nobody closed is refused', () => {
    expect(accepts('https://${NIBRUN_HOSTNAME')).toBe(false);
  });

  // The prefix is the whole of what expands, which is what lets a secret hold a `$` at all: a
  // bcrypt hash and a password that reads like a shell variable are values like any other.
  test('a $ that opens no reference is a $', () => {
    expect(accepts('$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF')).toBe(true);
    expect(accepts('$HOME/bin')).toBe(true);
    expect(accepts('$$')).toBe(true);
  });

  test('an edit is held to the same rule', () => {
    expect(
      isValidMessage({ schema: TenantEnvironmentPatchSchema, value: holding(`x${MISSPELLED}`) }),
    ).toBe(false);
    expect(
      isValidMessage({ schema: TenantEnvironmentPatchSchema, value: { CALLBACK_URL: null } }),
    ).toBe(true);
  });
});

/**
 * Which of the offered names an app has to have asked for. The schema cannot answer this — whether
 * a value is allowed depends on the config beside it — so it is a question rather than a pattern.
 */
describe('a value naming a runtime value only some apps are given', () => {
  test('either name, in either form', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated
    expect(namesExtraPublicPortValues('${NIBRUN_PUBLIC_IPV4}')).toBe(true);
    expect(namesExtraPublicPortValues('$NIBRUN_EXTRA_PUBLIC_PORT')).toBe(true);
    expect(namesExtraPublicPortValues('udp://$NIBRUN_PUBLIC_IPV4:$NIBRUN_EXTRA_PUBLIC_PORT')).toBe(
      true,
    );
  });

  test('a name every app is given is not one of them', () => {
    expect(namesExtraPublicPortValues('$NIBRUN_HOSTNAME')).toBe(false);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated
    expect(namesExtraPublicPortValues('${NIBRUN_HTTP_PORT}')).toBe(false);
  });

  // The guest reads a name to its last name character, so this is a longer name it does not offer
  // rather than one of these with something after it.
  test('a longer name is a different name', () => {
    expect(namesExtraPublicPortValues('$NIBRUN_PUBLIC_IPV4X')).toBe(false);
  });

  test('a value naming nothing names none of them', () => {
    expect(namesExtraPublicPortValues('$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF')).toBe(false);
    expect(namesExtraPublicPortValues('NIBRUN_PUBLIC_IPV4')).toBe(false);
  });
});

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

test('the poll settings the control plane hands out are themselves valid', () => {
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeGreaterThan(0);
  expect(DEFAULT_AGENT_POLL_SETTINGS.minIntervalMs).toBeLessThan(
    DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs,
  );
});

test('a timestamp brand is only obtained by parsing a plain string', () => {
  const now = Value.Parse(TimestampSchema, new Date().toISOString());
  expect(isValidMessage({ schema: TimestampSchema, value: now })).toBe(true);
});

const AN_INSTANT = Value.Parse(TimestampSchema, '2026-08-07T09:51:56.687Z');
const A_LATER_INSTANT = Value.Parse(TimestampSchema, '2026-08-07T09:51:56.756Z');

function logRecord(overrides: Partial<TenantLogRecord> = {}): TenantLogRecord {
  return {
    _time: AN_INSTANT,
    _msg: 'Server started at http://0.0.0.0:8090',
    hostId: 'host-1',
    SOURCE: 'tenant',
    appId: 'app-1',
    deploymentId: 'deployment-1',
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: 0,
    ...overrides,
  } as TenantLogRecord;
}

describe('a record read twice is handed over once', () => {
  test('the same record is not admitted a second time', () => {
    const seen = new SeenTenantLogs();

    expect(seen.admit(logRecord())).toBe(true);
    expect(seen.admit(logRecord())).toBe(false);
  });

  /**
   * The whole reason this is not a high-water mark. A program announcing itself writes several
   * lines in one millisecond, and the store hands that instant back in an order of its own — so
   * seeing the newest of them first must not condemn the rest as repeats.
   */
  test('the rest of an instant survives having seen its newest record first', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord({ sequence: 2 }));

    expect(seen.admit(logRecord({ sequence: 1 }))).toBe(true);
    expect(seen.admit(logRecord({ sequence: 0 }))).toBe(true);
  });

  test('the next record from the same source is new', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());

    expect(seen.admit(logRecord({ sequence: 1 }))).toBe(true);
  });

  // Sequence counts within one source, so the same number from another one is another record.
  test('a source that restarted is not the source that stopped', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());

    expect(seen.admit(logRecord({ sourceId: 'source-2' }))).toBe(true);
  });

  // What a reconnect asks for: the seconds it was away, which carry what it did not miss.
  test('an instant already passed is a repeat however it is numbered', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 5 }));

    expect(seen.admit(logRecord({ _time: AN_INSTANT, sequence: 0 }))).toBe(false);
  });

  // Only the newest instant's keys are kept, so following an app for a day costs one instant.
  test('moving on forgets the instant left behind', () => {
    const seen = new SeenTenantLogs();
    seen.admit(logRecord());
    seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 1 }));

    expect(seen.admit(logRecord({ _time: A_LATER_INSTANT, sequence: 1 }))).toBe(false);
  });
});

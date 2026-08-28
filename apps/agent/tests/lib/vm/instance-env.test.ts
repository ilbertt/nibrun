import { describe, expect, test } from 'bun:test';
import {
  type AppHostname,
  DEFAULT_HTTP_PORT,
  DEFAULT_RESTART_POLICY,
  HostnameSchema,
  HttpPortSchema,
  Value,
} from '@repo/protocol';
import { Either } from 'effect';
import { renderInstanceEnv } from '#lib/vm/instance-env.ts';
import { tenantEnvironment } from '#tests/support/fixtures.ts';

const NON_DEFAULT_PORT = 8080;

const PLATFORM_HOSTNAME = 'my-app.nibrun.app';

function hostname({ name, kind }: { name: string; kind: AppHostname['kind'] }): AppHostname {
  return { hostname: Value.Parse(HostnameSchema, name), kind };
}

const PLATFORM = hostname({ name: PLATFORM_HOSTNAME, kind: 'platform' });

type Overrides = Partial<Parameters<typeof renderInstanceEnv>[0]>;

function attempt(overrides: Overrides = {}) {
  return renderInstanceEnv({
    httpPort: DEFAULT_HTTP_PORT,
    hostnames: [PLATFORM],
    args: [],
    environment: {},
    restartPolicy: DEFAULT_RESTART_POLICY,
    ...overrides,
  });
}

function render(overrides: Overrides = {}) {
  return Either.getOrThrow(attempt(overrides));
}

function refusedVariable(overrides: Overrides) {
  const result = attempt(overrides);
  return Either.isLeft(result) ? result.left : undefined;
}

// apps/runtime/src/config.c accepts NIBRUN_ and ENV_ and rejects every other line, so these
// assertions are the boot contract rather than a formatting preference.
describe('what apps/runtime parses off the config drive', () => {
  test('every key it writes is one the runtime knows', () => {
    expect(render().split('\n').filter(Boolean)).toEqual([
      `NIBRUN_HTTP_PORT=${DEFAULT_HTTP_PORT}`,
      `NIBRUN_HOSTNAME=${PLATFORM_HOSTNAME}`,
      `NIBRUN_MAX_RESTARTS=${DEFAULT_RESTART_POLICY.maxRestarts}`,
      `NIBRUN_INITIAL_BACKOFF_MS=${DEFAULT_RESTART_POLICY.initialBackoffMs}`,
      `NIBRUN_MAX_BACKOFF_MS=${DEFAULT_RESTART_POLICY.maxBackoffMs}`,
      `NIBRUN_BACKOFF_FACTOR=${DEFAULT_RESTART_POLICY.backoffFactor}`,
      `NIBRUN_RESET_AFTER_MS=${DEFAULT_RESTART_POLICY.resetAfterMs}`,
      'NIBRUN_DNS=1.1.1.1,1.0.0.1',
    ]);
  });

  test('tenant variables carry the tenant prefix, in a stable order', () => {
    const rendered = render({ environment: tenantEnvironment({ ZED: '1', ALPHA: '2' }) });
    expect(rendered).toContain('\nENV_ALPHA=2\nENV_ZED=1\n');
  });

  // The prefix is what keeps the two apart on the drive: the runtime reads this as a tenant
  // variable named NIBRUN_HTTP_PORT, and drops it there rather than here.
  test('a tenant variable named after a runtime key is written under the tenant prefix', () => {
    const rendered = render({ environment: tenantEnvironment({ NIBRUN_HTTP_PORT: '9999' }) });
    expect(rendered).toContain(`NIBRUN_HTTP_PORT=${DEFAULT_HTTP_PORT}\n`);
    expect(rendered).toContain('ENV_NIBRUN_HTTP_PORT=9999\n');
  });

  test('values are raw bytes, not quoted or escaped', () => {
    const rendered = render({
      environment: tenantEnvironment({ DSN: 'postgres://u:p@h/db?x=1 y=2' }),
    });
    expect(rendered).toContain('ENV_DSN=postgres://u:p@h/db?x=1 y=2\n');
  });

  test('an empty value stays an empty value', () => {
    expect(render({ environment: tenantEnvironment({ EMPTY: '' }) })).toContain('ENV_EMPTY=\n');
  });

  // The app answers on every hostname it holds, but only this one was issued by nibrun and
  // cannot be taken away, so it is the one a binary can safely address itself by.
  test('the hostname written is the platform one, whatever else the app answers on', () => {
    const rendered = render({
      hostnames: [hostname({ name: 'www.example.com', kind: 'custom' }), PLATFORM],
    });
    expect(rendered).toContain(`NIBRUN_HOSTNAME=${PLATFORM_HOSTNAME}\n`);
    expect(rendered).not.toContain('www.example.com');
  });

  // A guest image older than this agent rejects a key it does not know, and would fail every
  // boot on the fleet. Optional there, omitted here, so the two can be deployed apart.
  test('an app with no platform hostname is sent no line rather than an empty one', () => {
    expect(render({ hostnames: [] })).not.toContain('NIBRUN_HOSTNAME');
  });

  test('a non-default port is the one written', () => {
    expect(render({ httpPort: Value.Parse(HttpPortSchema, NON_DEFAULT_PORT) })).toContain(
      `NIBRUN_HTTP_PORT=${NON_DEFAULT_PORT}\n`,
    );
  });
});

describe('what has no representation fails the instance', () => {
  test.each([['\n'], ['\r'], ['\0']])(
    'a value containing %j is refused rather than truncated',
    (character) => {
      expect(
        refusedVariable({ environment: tenantEnvironment({ BAD: `a${character}INJECTED=1` }) })
          ?.variableName,
      ).toBe('BAD');
    },
  );

  test('the failure names the variable but never carries its value', () => {
    const refused = refusedVariable({
      environment: tenantEnvironment({ API_KEY: 'secret-value\nmore' }),
    });
    expect(refused?.variableName).toBe('API_KEY');
    expect(JSON.stringify(refused)).not.toContain('secret-value');
  });
});

describe('arguments reach the guest as the user wrote them', () => {
  test('they are numbered from zero, in order', () => {
    const rendered = render({ args: ['serve', '--http=0.0.0.0:8090'] });

    expect(rendered).toContain('NIBRUN_ARG_0=serve');
    // Splitting on the first `=` only is what lets a flag carry its own value.
    expect(rendered).toContain('NIBRUN_ARG_1=--http=0.0.0.0:8090');
  });

  test('a binary that needs none is given none', () => {
    expect(render({ args: [] })).not.toContain('NIBRUN_ARG_');
  });

  test('an argument with no representation fails the instance rather than truncating', () => {
    expect(refusedVariable({ args: ['--flag=one\ntwo'] })?.variableName).toBe('NIBRUN_ARG_0');
  });
});

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_GUEST_PORT,
  DEFAULT_RESTART_POLICY,
  GuestPortSchema,
  SecretStringSchema,
  Value,
} from '@repo/protocol';
import { Either } from 'effect';
import { renderInstanceEnv } from '#lib/vm/instance-env.ts';

const NON_DEFAULT_PORT = 8080;

function secret(value: string) {
  return Value.Parse(SecretStringSchema, value);
}

type Overrides = Partial<Parameters<typeof renderInstanceEnv>[0]>;

function attempt(overrides: Overrides = {}) {
  return renderInstanceEnv({
    guestPort: DEFAULT_GUEST_PORT,
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
  test('the runtime keys it requires are all present', () => {
    expect(render().split('\n').filter(Boolean)).toEqual([
      `NIBRUN_PORT=${DEFAULT_GUEST_PORT}`,
      `NIBRUN_MAX_RESTARTS=${DEFAULT_RESTART_POLICY.maxRestarts}`,
      `NIBRUN_INITIAL_BACKOFF_MS=${DEFAULT_RESTART_POLICY.initialBackoffMs}`,
      `NIBRUN_MAX_BACKOFF_MS=${DEFAULT_RESTART_POLICY.maxBackoffMs}`,
      `NIBRUN_BACKOFF_FACTOR=${DEFAULT_RESTART_POLICY.backoffFactor}`,
      `NIBRUN_RESET_AFTER_MS=${DEFAULT_RESTART_POLICY.resetAfterMs}`,
      'NIBRUN_DNS=1.1.1.1,1.0.0.1',
    ]);
  });

  test('tenant variables carry the tenant prefix, in a stable order', () => {
    const rendered = render({ environment: { ZED: secret('1'), ALPHA: secret('2') } });
    expect(rendered).toContain('\nENV_ALPHA=2\nENV_ZED=1\n');
  });

  // The prefix is what makes this impossible rather than merely handled: the runtime reads it
  // as a tenant variable named NIBRUN_PORT, and its own PORT stays the one written above.
  test('a tenant variable named after a runtime key stays the tenant’s', () => {
    const rendered = render({ environment: { NIBRUN_PORT: secret('9999') } });
    expect(rendered).toContain(`NIBRUN_PORT=${DEFAULT_GUEST_PORT}\n`);
    expect(rendered).toContain('ENV_NIBRUN_PORT=9999\n');
  });

  test('values are raw bytes, not quoted or escaped', () => {
    const rendered = render({ environment: { DSN: secret('postgres://u:p@h/db?x=1 y=2') } });
    expect(rendered).toContain('ENV_DSN=postgres://u:p@h/db?x=1 y=2\n');
  });

  test('an empty value stays an empty value', () => {
    expect(render({ environment: { EMPTY: secret('') } })).toContain('ENV_EMPTY=\n');
  });

  test('a non-default port is the one written', () => {
    expect(render({ guestPort: Value.Parse(GuestPortSchema, NON_DEFAULT_PORT) })).toContain(
      `NIBRUN_PORT=${NON_DEFAULT_PORT}\n`,
    );
  });
});

describe('what has no representation fails the instance', () => {
  test.each([['\n'], ['\r'], ['\0']])(
    'a value containing %j is refused rather than truncated',
    (character) => {
      expect(
        refusedVariable({ environment: { BAD: secret(`a${character}INJECTED=1`) } })?.variableName,
      ).toBe('BAD');
    },
  );

  test('the failure names the variable but never carries its value', () => {
    const refused = refusedVariable({
      environment: { API_KEY: secret('secret-value\nmore') },
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

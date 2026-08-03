import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_GUEST_PORT,
  DEFAULT_RESTART_POLICY,
  type GuestPort,
  type SecretString,
} from '@repo/protocol';
import { renderInstanceEnv, UnrepresentableEnvironmentError } from '#vm/instance-env.ts';

const secret = (value: string) => value as SecretString;

const render = (
  overrides: Partial<Parameters<typeof renderInstanceEnv>[0]> = {},
): ReturnType<typeof renderInstanceEnv> =>
  renderInstanceEnv({
    guestPort: DEFAULT_GUEST_PORT,
    environment: {},
    restartPolicy: DEFAULT_RESTART_POLICY,
    dnsServers: [],
    ...overrides,
  });

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

  test('nameservers are one comma-joined line, and absent when there are none', () => {
    expect(render({ dnsServers: ['1.1.1.1', '8.8.8.8'] })).toContain(
      'NIBRUN_DNS=1.1.1.1,8.8.8.8\n',
    );
    expect(render()).not.toContain('NIBRUN_DNS');
  });

  test('values are raw bytes, not quoted or escaped', () => {
    const rendered = render({ environment: { DSN: secret('postgres://u:p@h/db?x=1 y=2') } });
    expect(rendered).toContain('ENV_DSN=postgres://u:p@h/db?x=1 y=2\n');
  });

  test('an empty value stays an empty value', () => {
    expect(render({ environment: { EMPTY: secret('') } })).toContain('ENV_EMPTY=\n');
  });

  test('a non-default port is the one written', () => {
    expect(render({ guestPort: 8080 as GuestPort })).toContain('NIBRUN_PORT=8080\n');
  });
});

describe('what has no representation fails the instance', () => {
  test.each([['\n'], ['\r'], ['\0']])(
    'a value containing %j is refused rather than truncated',
    (character) => {
      expect(() => render({ environment: { BAD: secret(`a${character}INJECTED=1`) } })).toThrow(
        UnrepresentableEnvironmentError,
      );
    },
  );

  test('the error names the variable but never carries its value', () => {
    const error = (() => {
      try {
        render({ environment: { API_KEY: secret('secret-value\nmore') } });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error?.message).toContain('API_KEY');
    expect(error?.message).not.toContain('secret-value');
  });
});

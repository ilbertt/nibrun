import { describe, expect, test } from 'bun:test';
import { DEFAULT_GUEST_PORT, type GuestPort, type SecretString } from '@repo/protocol';
import { renderInstanceEnv, UnrepresentableEnvironmentError } from '#vm/instance-env.ts';

const secret = (value: string) => value as SecretString;

describe('instance.env is line-oriented so the guest needs no parser', () => {
  test('PORT is written from the declared guest port', () => {
    expect(renderInstanceEnv({ guestPort: DEFAULT_GUEST_PORT, environment: {} })).toBe(
      `PORT=${DEFAULT_GUEST_PORT}\n`,
    );
  });

  test('a tenant PORT cannot override the port the host forwards to', () => {
    const rendered = renderInstanceEnv({
      guestPort: 8080 as GuestPort,
      environment: { PORT: secret('9999') },
    });
    expect(rendered).toBe('PORT=8080\n');
  });

  test('variables are emitted in a stable order', () => {
    const rendered = renderInstanceEnv({
      guestPort: DEFAULT_GUEST_PORT,
      environment: { ZED: secret('1'), ALPHA: secret('2') },
    });
    expect(rendered.split('\n')).toEqual([`PORT=${DEFAULT_GUEST_PORT}`, 'ALPHA=2', 'ZED=1', '']);
  });

  test('values are raw bytes, not quoted or escaped', () => {
    const rendered = renderInstanceEnv({
      guestPort: DEFAULT_GUEST_PORT,
      environment: { DSN: secret('postgres://u:p@h/db?x=1 y=2') },
    });
    expect(rendered).toContain('DSN=postgres://u:p@h/db?x=1 y=2\n');
  });

  test('an empty value stays an empty value', () => {
    expect(
      renderInstanceEnv({ guestPort: DEFAULT_GUEST_PORT, environment: { EMPTY: secret('') } }),
    ).toContain('EMPTY=\n');
  });
});

describe('what has no representation fails the instance', () => {
  test.each([['\n'], ['\r'], ['\0']])(
    'a value containing %j is refused rather than truncated',
    (character) => {
      expect(() =>
        renderInstanceEnv({
          guestPort: DEFAULT_GUEST_PORT,
          environment: { BAD: secret(`a${character}INJECTED=1`) },
        }),
      ).toThrow(UnrepresentableEnvironmentError);
    },
  );

  test('the error names the variable but never carries its value', () => {
    const error = (() => {
      try {
        renderInstanceEnv({
          guestPort: DEFAULT_GUEST_PORT,
          environment: { API_KEY: secret('secret-value\nmore') },
        });
      } catch (caught) {
        return caught as Error;
      }
      return undefined;
    })();
    expect(error?.message).toContain('API_KEY');
    expect(error?.message).not.toContain('secret-value');
  });
});

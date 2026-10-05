import { describe, expect, test } from 'bun:test';
import { isValidMessage, SecretStringSchema, TenantEnvironmentSchema, Value } from '@repo/protocol';
import { namesExtraPublicPortValues } from '#lib/runtime-values.ts';
import { TenantEnvironmentPatchSchema } from '#schemas/environment.ts';

const TENANT_SECRET = Value.Parse(SecretStringSchema, 'sk-live-do-not-log-this');

describe('a variable named __proto__ is not one', () => {
  // Built with fromEntries rather than a literal, which is the one way to give a plain object that
  // key as a property at all — and the shape the api would receive from JSON.parse.
  function named(name: string) {
    return Object.fromEntries([[name, TENANT_SECRET]]);
  }

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
  const OFFERED = `\${NIBRUN_HOSTNAME}`;
  const MISSPELLED = `\${NIBRUN_HSOTNAME}`;

  function holding(value: string) {
    return { CALLBACK_URL: value };
  }

  function accepts(value: string) {
    return isValidMessage({ schema: TenantEnvironmentSchema, value: holding(value) });
  }

  test('complete runtime references are accepted', () => {
    expect(accepts(`https://${OFFERED}/callback`)).toBe(true);
    expect(accepts(`\${NIBRUN_HTTP_PORT}`)).toBe(true);
  });

  test('a name the guest does not offer is refused', () => {
    expect(accepts(`https://${MISSPELLED}/callback`)).toBe(false);
    expect(accepts(`\${NIBRUN_HTTP_PORTS}`)).toBe(false);
  });

  test('a brace nobody closed is literal', () => {
    expect(accepts(`https://\${NIBRUN_HOSTNAME`)).toBe(true);
  });

  test('a $ that opens no reference is a $', () => {
    expect(accepts('$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF')).toBe(true);
    expect(accepts('$HOME/bin')).toBe(true);
    for (const literal of [
      '$',
      '{',
      '}',
      `\${`,
      `\${}`,
      '$NIBRUN_HTTP_PORT',
      '$NIBRUN_NOTHING',
      '$NIBRUN_PUBLIC_IPV4',
      '$NIBRUN_EXTRA_PUBLIC_PORT',
      `\${NIBRUN_NOTHING`,
      '{NIBRUN_HTTP_PORT}',
      `\${NIBRUN_HTTP_PORT!}`,
      `\${NIBRUN_HTTP_PORT with spaces}`,
      'secret$NIBRUN_HTTP_PORT}suffix',
    ]) {
      expect(accepts(literal)).toBe(true);
      expect(
        isValidMessage({ schema: TenantEnvironmentPatchSchema, value: holding(literal) }),
      ).toBe(true);
    }
    expect(accepts(`$${OFFERED}|{${OFFERED}}|\${NIBRUN_BROKEN:${OFFERED}|$`)).toBe(true);
    expect(accepts(`\${NIBRUN_BROKEN:${MISSPELLED}`)).toBe(false);
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
  test('either name in a complete reference', () => {
    expect(namesExtraPublicPortValues(`\${NIBRUN_PUBLIC_IPV4}`)).toBe(true);
    expect(namesExtraPublicPortValues(`\${NIBRUN_EXTRA_PUBLIC_PORT}`)).toBe(true);
    expect(namesExtraPublicPortValues(`\${NIBRUN_PUBLIC_IPV4}:\${NIBRUN_EXTRA_PUBLIC_PORT}`)).toBe(
      true,
    );
  });

  test('a name every app is given is not one of them', () => {
    expect(namesExtraPublicPortValues('$NIBRUN_HOSTNAME')).toBe(false);
    expect(namesExtraPublicPortValues(`\${NIBRUN_HTTP_PORT}`)).toBe(false);
  });

  test('a longer name is a different name', () => {
    expect(namesExtraPublicPortValues(`\${NIBRUN_PUBLIC_IPV4X}`)).toBe(false);
  });

  test('a value naming nothing names none of them', () => {
    expect(namesExtraPublicPortValues('$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF')).toBe(false);
    for (const literal of [
      'NIBRUN_PUBLIC_IPV4',
      '$NIBRUN_PUBLIC_IPV4',
      '$NIBRUN_EXTRA_PUBLIC_PORT',
      `\${NIBRUN_PUBLIC_IPV4`,
      `\${NIBRUN_EXTRA_PUBLIC_PORT!}`,
    ]) {
      expect(namesExtraPublicPortValues(literal)).toBe(false);
    }
  });
});

import { describe, expect, test } from 'bun:test';
import { namesExtraPublicPortValues } from '#lib/runtime-values.ts';

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

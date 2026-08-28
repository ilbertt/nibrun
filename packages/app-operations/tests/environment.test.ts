import { describe, expect, test } from 'bun:test';
import { parseEnvironment, parseEnvironmentPatch } from '#environment.ts';
import { InvalidEnvironmentError } from '#errors.ts';

// The values come back branded as secrets, which is not what a literal in an expectation is.
function parsed({
  set = [],
  remove = [],
}: {
  set?: string[];
  remove?: string[];
}): Record<string, string | null> {
  return parseEnvironment({ set, remove });
}

test('a name and a value become one entry', () => {
  expect(parsed({ set: ['OPENCLAW_STATE_DIR=/app/data/.openclaw'] })).toEqual({
    OPENCLAW_STATE_DIR: '/app/data/.openclaw',
  });
});

test('several are one edit', () => {
  expect(parsed({ set: ['A=1', 'B=2'] })).toEqual({ A: '1', B: '2' });
});

// A value is arbitrary text and secrets routinely hold an `=`, so only the first one separates.
test('only the first separator separates', () => {
  expect(parsed({ set: ['TOKEN=a=b=c'] })).toEqual({ TOKEN: 'a=b=c' });
});

test('an empty value is a value', () => {
  expect(parsed({ set: ['EMPTY='] })).toEqual({ EMPTY: '' });
});

test('the last value given for a name is the one it takes', () => {
  expect(parsed({ set: ['PORT=1', 'PORT=2'] })).toEqual({ PORT: '2' });
});

// A name alone cannot mean "set this to nothing": an empty value is a value, and the only way to
// say a variable should go is to say nothing about what it holds.
test('a name to remove is that name and no value', () => {
  expect(parsed({ set: ['A=1'], remove: ['B'] })).toEqual({ A: '1', B: null });
});

describe('what is refused as something that was typed wrong', () => {
  test('a word with no value', () => {
    expect(() => parsed({ set: ['JUST_A_NAME'] })).toThrow(InvalidEnvironmentError);
  });

  test('a value with no name', () => {
    expect(() => parsed({ set: ['=orphaned'] })).toThrow(InvalidEnvironmentError);
  });

  test('a name a shell would not accept either', () => {
    expect(() => parsed({ set: ['NOT-A-NAME=1'] })).toThrow(InvalidEnvironmentError);
  });

  test('a name that starts with a digit', () => {
    expect(() => parsed({ set: ['1ST=1'] })).toThrow(InvalidEnvironmentError);
  });

  // Removing is the same name in the same place, so it is held to the same rule.
  test('a name to remove that could never have been set', () => {
    expect(() => parsed({ remove: ['NOT-A-NAME'] })).toThrow(InvalidEnvironmentError);
  });

  /**
   * A name a shell would take, and the one an environment cannot survive: it travels as a
   * JavaScript object, where writing that key sets a prototype rather than a property. Refusing it
   * here is what makes it something the person typing it is told, rather than a variable they set
   * and nobody ever carries.
   */
  test('the one name that would be lost between here and the host', () => {
    expect(() => parsed({ set: ['__proto__=1'] })).toThrow(InvalidEnvironmentError);
    expect(() => parsed({ set: ['__proto__x=1'] })).not.toThrow();
  });
});

/**
 * The guest expands a value that names a runtime value it sets, and fails the boot over a name it
 * does not offer. Refused here, a typo costs a sentence rather than a deploy that never serves and
 * says why only in the instance's console.
 */
describe('a value naming a runtime value', () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
  const OFFERED = '${NIBRUN_HOSTNAME}';
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the syntax being validated, not an interpolation
  const MISSPELLED = '${NIBRUN_HSOTNAME}';

  test('one the guest offers is carried through as it was written', () => {
    expect(parsed({ set: [`URL=https://${OFFERED}`] })).toEqual({ URL: `https://${OFFERED}` });
    expect(parsed({ set: ['URL=http://$NIBRUN_HOSTNAME:$NIBRUN_HTTP_PORT'] })).toEqual({
      URL: 'http://$NIBRUN_HOSTNAME:$NIBRUN_HTTP_PORT',
    });
  });

  test('one it does not is refused, and the variable holding it is named', () => {
    expect(() => parsed({ set: [`URL=https://${MISSPELLED}`] })).toThrow(
      new InvalidEnvironmentError(
        `A value may name a runtime value the guest sets — \${NIBRUN_DATA_DIR}, ${OFFERED}, \${NIBRUN_HTTP_PORT} — and nothing else: URL`,
      ),
    );
  });

  // The prefix is the whole of what expands, so a secret that reads like a shell variable is a
  // value like any other rather than something to escape.
  test('a $ that opens no reference is left alone', () => {
    expect(parsed({ set: ['HASH=$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF'] })).toEqual({
      HASH: '$2y$10$K3JqBQ8Rt7uVwXyZaBcDeF',
    });
  });
});

describe('an edit given as a name and a value already apart', () => {
  function edited(edits: Array<{ name: string; value: string | null }>) {
    return parseEnvironmentPatch(edits) as Record<string, string | null>;
  }

  test('a value sets the variable and null removes it', () => {
    expect(
      edited([
        { name: 'TOKEN', value: 'sk-1' },
        { name: 'GONE', value: null },
      ]),
    ).toEqual({ TOKEN: 'sk-1', GONE: null });
  });

  // The same refusal wherever a name was typed: a form with a field for each half must not accept
  // what the command line would not.
  test('a name a shell would not accept either is refused here too', () => {
    expect(() => edited([{ name: 'NOT-A-NAME', value: '1' }])).toThrow(InvalidEnvironmentError);
  });
});

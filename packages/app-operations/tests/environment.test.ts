import { describe, expect, test } from 'bun:test';
import { parseEnvironment } from '#environment.ts';
import { InvalidEnvironmentError } from '#errors.ts';

// The values come back branded as secrets, which is not what a literal in an expectation is.
function parsed(assignments: string[]): Record<string, string> {
  return parseEnvironment(assignments);
}

test('a name and a value become one entry', () => {
  expect(parsed(['OPENCLAW_STATE_DIR=/app/data/.openclaw'])).toEqual({
    OPENCLAW_STATE_DIR: '/app/data/.openclaw',
  });
});

test('several are one environment', () => {
  expect(parsed(['A=1', 'B=2'])).toEqual({ A: '1', B: '2' });
});

// A value is arbitrary text and secrets routinely hold an `=`, so only the first one separates.
test('only the first separator separates', () => {
  expect(parsed(['TOKEN=a=b=c'])).toEqual({ TOKEN: 'a=b=c' });
});

test('an empty value is a value', () => {
  expect(parsed(['EMPTY='])).toEqual({ EMPTY: '' });
});

test('the last value given for a name is the one it takes', () => {
  expect(parsed(['PORT=1', 'PORT=2'])).toEqual({ PORT: '2' });
});

describe('what is refused as something that was typed wrong', () => {
  test('a word with no value', () => {
    expect(() => parseEnvironment(['JUST_A_NAME'])).toThrow(InvalidEnvironmentError);
  });

  test('a value with no name', () => {
    expect(() => parseEnvironment(['=orphaned'])).toThrow(InvalidEnvironmentError);
  });

  test('a name a shell would not accept either', () => {
    expect(() => parseEnvironment(['NOT-A-NAME=1'])).toThrow(InvalidEnvironmentError);
  });

  test('a name that starts with a digit', () => {
    expect(() => parseEnvironment(['1ST=1'])).toThrow(InvalidEnvironmentError);
  });
});

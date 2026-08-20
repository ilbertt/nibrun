import { expect, test } from 'bun:test';
import { REDACTED } from '@repo/protocol';
import {
  type EnvironmentVariable,
  environmentEdits,
  repeatedName,
  storedVariables,
} from '#lib/environment-variables.ts';
import type { AppSummary } from '#queries/apps.ts';

const STORED = ['TOKEN', 'LOG_LEVEL'];

// The one field any of this reads; the rest of an app response is nothing to do with it.
const APP = {
  config: { environment: { TOKEN: REDACTED, LOG_LEVEL: REDACTED } },
} as unknown as AppSummary;

function rows(): EnvironmentVariable[] {
  return storedVariables(APP);
}

function edits(variables: readonly EnvironmentVariable[] | undefined) {
  return environmentEdits({ variables, stored: STORED });
}

/**
 * The whole of what a deploy says about an app's environment is decided here, and every way of
 * getting it wrong erases a secret: an owner cannot read one back, so nothing downstream can put
 * back what this leaves out by mistake.
 */
test('a table nobody touched says nothing at all', () => {
  expect(edits(undefined)).toEqual([]);
});

test('rows still sealed are left out, which is what keeps their values', () => {
  expect(edits(rows())).toEqual([]);
});

test('a value that was typed is sent as that value', () => {
  const replaced = rows().map((variable) =>
    variable.name === 'TOKEN' ? { ...variable, value: 'sk-new', sealed: false } : variable,
  );

  expect(edits(replaced)).toEqual([{ name: 'TOKEN', value: 'sk-new' }]);
});

// The only way to say a variable should go: an empty value is a value, and a row that is simply
// absent would read as one to leave alone.
test('a name the app has that the table no longer does is sent as null', () => {
  const removed = rows().filter((variable) => variable.name !== 'LOG_LEVEL');

  expect(edits(removed)).toEqual([{ name: 'LOG_LEVEL', value: null }]);
});

test('a variable added alongside them is sent with the rest', () => {
  const added = [...rows(), { id: 'new', name: ' PORT ', value: '8080', sealed: false }];

  expect(edits(added)).toEqual([{ name: 'PORT', value: '8080' }]);
});

test('a row nobody filled in is not a variable', () => {
  const blank = [...rows(), { id: 'new', name: '', value: '', sealed: false }];

  expect(edits(blank)).toEqual([]);
});

test('two rows under one name are found before either is sent', () => {
  const twice = [...rows(), { id: 'new', name: 'TOKEN', value: 'sk-other', sealed: false }];

  expect(repeatedName(twice)).toBe('TOKEN');
});

import { describe, expect, test } from 'bun:test';
import { parseEnvFile } from '#env-file.ts';
import { InvalidEnvironmentError } from '#errors.ts';

test('a name and a value per line', () => {
  expect(parseEnvFile('PORT=8080\nLOG_LEVEL=debug')).toEqual([
    { name: 'PORT', value: '8080' },
    { name: 'LOG_LEVEL', value: 'debug' },
  ]);
});

test('blank lines and comments set nothing', () => {
  expect(parseEnvFile('# what this app runs with\n\nPORT=8080\n')).toEqual([
    { name: 'PORT', value: '8080' },
  ]);
});

// A file that was written to be sourced by a shell is still a file someone will pick here.
test('a name may be exported', () => {
  expect(parseEnvFile('export TOKEN=sk-1')).toEqual([{ name: 'TOKEN', value: 'sk-1' }]);
});

test('only the first separator separates', () => {
  expect(parseEnvFile('TOKEN=a=b=c')).toEqual([{ name: 'TOKEN', value: 'a=b=c' }]);
});

test('what follows a # is a comment on the value, not part of it', () => {
  expect(parseEnvFile('PORT=8080 # what it listens on')).toEqual([{ name: 'PORT', value: '8080' }]);
});

describe('a quoted value is taken as it was written', () => {
  test('quotes keep the spaces they hold', () => {
    expect(parseEnvFile('GREETING="  hello  "')).toEqual([
      { name: 'GREETING', value: '  hello  ' },
    ]);
  });

  test('a # inside quotes is part of the value', () => {
    expect(parseEnvFile('TOKEN="sk-#-1"')).toEqual([{ name: 'TOKEN', value: 'sk-#-1' }]);
  });

  test('double quotes carry escapes', () => {
    expect(parseEnvFile('KEY="one\\ntwo"')).toEqual([{ name: 'KEY', value: 'one\ntwo' }]);
  });

  // A backslash is a backslash inside single quotes, as it is in a shell — a Windows path ending
  // in one would otherwise swallow the quote that closes it.
  test('single quotes carry none', () => {
    expect(parseEnvFile("DIR='C:\\data\\'")).toEqual([{ name: 'DIR', value: 'C:\\data\\' }]);
  });

  // A private key is the reason this is worth reading: it arrives as lines, and every one of them
  // belongs to the value.
  test('a quoted value may run over several lines', () => {
    const file = 'KEY="-----BEGIN-----\nabc\ndef\n-----END-----"\nPORT=8080';

    expect(parseEnvFile(file)).toEqual([
      { name: 'KEY', value: '-----BEGIN-----\nabc\ndef\n-----END-----' },
      { name: 'PORT', value: '8080' },
    ]);
  });
});

describe('what is refused rather than skipped', () => {
  test('a line that sets nothing', () => {
    expect(() => parseEnvFile('PORT=8080\njust a sentence')).toThrow(InvalidEnvironmentError);
  });

  test('a value with no name', () => {
    expect(() => parseEnvFile('=orphaned')).toThrow(InvalidEnvironmentError);
  });

  test('a quote nothing closes', () => {
    expect(() => parseEnvFile('KEY="never closed')).toThrow(InvalidEnvironmentError);
  });
});

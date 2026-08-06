import { expect, test } from 'bun:test';
import { parseCommandLine } from '#lib/command-line.ts';

test('a binary on its own is a command line with nothing to add', () => {
  expect(parseCommandLine('./my-server')).toEqual({ binaryPath: './my-server', args: [] });
});

test('everything after the binary is the binary its arguments', () => {
  expect(parseCommandLine('./my-server serve --port 8080')).toEqual({
    binaryPath: './my-server',
    args: ['serve', '--port', '8080'],
  });
});

test('a flag written here is the tenant its own, whatever this program calls the same flag', () => {
  expect(parseCommandLine('./my-server --help --yes').args).toEqual(['--help', '--yes']);
});

test('quotes hold a value together, and are gone from the value they held', () => {
  expect(parseCommandLine(`'/my apps/server' --name "foo bar"`)).toEqual({
    binaryPath: '/my apps/server',
    args: ['--name', 'foo bar'],
  });
});

test('single quotes pass their contents through untouched', () => {
  expect(parseCommandLine(`./my-server --match '\\d+\\s"x"'`).args).toEqual([
    '--match',
    '\\d+\\s"x"',
  ]);
});

test('a backslash outside single quotes escapes what follows it', () => {
  expect(parseCommandLine('./my-server --name foo\\ bar').args).toEqual(['--name', 'foo bar']);
});

test('an argument may be deliberately empty', () => {
  expect(parseCommandLine(`./my-server --name ''`).args).toEqual(['--name', '']);
});

test('runs of whitespace separate rather than produce arguments', () => {
  expect(parseCommandLine('  ./my-server   serve  ')).toEqual({
    binaryPath: './my-server',
    args: ['serve'],
  });
});

test('a quote nothing closes is refused rather than guessed at', () => {
  expect(() => parseCommandLine(`./my-server --name "foo`)).toThrow('Unbalanced');
});

test('a command line naming nothing is refused', () => {
  expect(() => parseCommandLine('   ')).toThrow('Name the binary to run.');
});

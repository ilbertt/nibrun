import { describe, expect, test } from 'bun:test';
import { runCommand } from '#lib/run-command.ts';

describe('the command names the binary the owner uploaded', () => {
  test('a binary with no arguments runs bare', () => {
    expect(runCommand({ binaryName: 'server', args: [] })).toBe('./server');
  });

  test('arguments follow it in the order they are configured', () => {
    expect(runCommand({ binaryName: 'server', args: ['serve', '--verbose'] })).toBe(
      './server serve --verbose',
    );
  });
});

/**
 * The whole point of the button is that what lands on the clipboard can be pasted, and an
 * argument is arbitrary text: a value carrying a space is one argument, not two, and one carrying
 * a `$` is text rather than something a shell should go and look up.
 */
describe('an argument reaches the clipboard as the one argument it is', () => {
  test('a space is quoted rather than left to split the argument', () => {
    expect(runCommand({ binaryName: 'server', args: ['--name', 'my app'] })).toBe(
      "./server --name 'my app'",
    );
  });

  test('a shell expansion is quoted rather than left to expand', () => {
    expect(runCommand({ binaryName: 'server', args: ['--greet=$USER; rm -rf /'] })).toBe(
      "./server '--greet=$USER; rm -rf /'",
    );
  });

  test('a single quote closes the quoting, escapes, and opens it again', () => {
    expect(runCommand({ binaryName: 'server', args: ["it's"] })).toBe("./server 'it'\\''s'");
  });

  test('a name with a space is quoted along with the path that runs it', () => {
    expect(runCommand({ binaryName: 'my server', args: [] })).toBe("'./my server'");
  });
});

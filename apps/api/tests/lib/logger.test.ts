import { describe, expect, test } from 'bun:test';

const LOGGER_URL = new URL('../../src/lib/logger.ts', import.meta.url).href;
const SCRIPT = `
  import { createLogger } from ${JSON.stringify(LOGGER_URL)};
  const logger = createLogger('service');
  logger.debug('debug message');
  logger.info('info message');
  logger.warn('warn message');
  logger.error('error message');
  createLogger().info('unprefixed message');
`;

function output(env: Record<string, string | undefined>) {
  const result = Bun.spawnSync([process.execPath, '-e', SCRIPT], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function expectLogLines({ stdout, stderr }: { stdout: string; stderr: string }) {
  const lines = Bun.stripANSI(stdout).trimEnd().split('\n');
  expect(lines).toEqual([
    expect.stringMatching(/^\S+ DEBUG \[service\] debug message$/),
    expect.stringMatching(/^\S+ INFO {2}\[service\] info message$/),
    expect.stringMatching(/^\S+ WARN {2}\[service\] warn message$/),
    expect.stringMatching(/^\S+ INFO {2}unprefixed message$/),
  ]);
  expect(Bun.stripANSI(stderr)).toMatch(/^\S+ ERROR \[service\] error message\n$/);
}

describe('API logger colors', () => {
  test('redirected output contains no ANSI codes', () => {
    const result = output({ NO_COLOR: undefined, FORCE_COLOR: undefined, TERM: 'dumb' });
    expectLogLines(result);
    expect(result.stdout).not.toContain('\x1b');
    expect(result.stderr).not.toContain('\x1b');
  });

  test('NO_COLOR leaves labels and messages plain', () => {
    const result = output({ NO_COLOR: '1', FORCE_COLOR: undefined });
    expectLogLines(result);
    expect(result.stdout).not.toContain('\x1b');
    expect(result.stderr).not.toContain('\x1b');
  });

  test('forced colors end before the prefix and message', () => {
    const result = output({ NO_COLOR: undefined, FORCE_COLOR: '1' });
    expectLogLines(result);
    for (const line of `${result.stdout}${result.stderr}`.trimEnd().split('\n')) {
      expect(line).toContain('\x1b[');
      expect(line).toContain('\x1b[0m');
      expect(
        line.split('\x1b[0m').some((part) => /^ (?:\[service\] )?\w+ message$/.test(part)),
      ).toBe(true);
    }
  });
});

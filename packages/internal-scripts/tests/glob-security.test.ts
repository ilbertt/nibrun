import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MATCH_TIMEOUT_MS = 3000;
const ATTACK_INPUT_LENGTH = 80;
const matcherPath = fileURLToPath(import.meta.resolve('picomatch'));

function nodeExecutable() {
  // Workspace tests put Bun's node shim first on PATH; the exploit also needs real V8 coverage.
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? 'node.exe' : 'node');
    if (!existsSync(candidate)) {
      continue;
    }
    const result = spawnSync(
      candidate,
      ['--eval', 'if (!process.versions.bun) process.stdout.write(process.execPath)'],
      { encoding: 'utf8', timeout: MATCH_TIMEOUT_MS },
    );
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  throw new Error('The glob security test requires the Node.js runtime used by the build.');
}

const nodePath = nodeExecutable();

function runMatcher(script: string) {
  for (const executable of [nodePath, process.execPath]) {
    const result = spawnSync(
      executable,
      [
        '--eval',
        `const assert = require('node:assert/strict'); const matcher = require(${JSON.stringify(matcherPath)}); ${script}`,
      ],
      { encoding: 'utf8', timeout: MATCH_TIMEOUT_MS },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }
}

test('repeated wildcard extglobs cannot stall the matcher on CVE-2026-112366 inputs', function boundsMaliciousGlobMatching() {
  const input = `${'a'.repeat(ATTACK_INPUT_LENGTH)}!`;
  const cases = [
    ['+(*a)', input],
    ['*(*a)', input],
    ['+(*)b', input],
    ['*(*)b', input],
    ['+(*a)c', input],
    ['+(a*b)', `${'ab'.repeat(ATTACK_INPUT_LENGTH)}!`],
    ['+(**a)', input],
    ['+(@(*a))', input],
    ['+(?(*a))', input],
  ];
  runMatcher(`
    for (const options of [{}, { windows: true }, { capture: true }]) {
      for (const [pattern, input] of ${JSON.stringify(cases)}) {
        assert.equal(matcher.isMatch(input, pattern, options), false, pattern);
      }
    }
  `);
});

test('the security replacement preserves normal file patterns and supported extglobs', function preservesFileMatching() {
  const cases = [
    ['src/app.ts', 'src/**/*.ts', true],
    ['src/app.js', 'src/**/*.ts', false],
    ['node_modules/pkg/index.js', '**/node_modules/**', true],
    ['file.ts', '*.{js,ts}', true],
    ['src/app.test.ts', '**/*.test.ts', true],
    ['file.jsx', '**/*.{js,jsx,ts,tsx}', true],
    ['.env', '*', false],
    ['abaaa', '+(*a)', true],
    ['aa', '+(a)', true],
    ['bar', '@(foo|bar)', true],
    ['baz', '@(foo|bar)', false],
  ];
  runMatcher(`
    for (const [input, pattern, expected] of ${JSON.stringify(cases)}) {
      assert.equal(matcher.isMatch(input, pattern), expected, pattern);
    }
  `);
});

import { expect, test } from 'bun:test';
import { join } from 'node:path';

const PROXY_TEST_TIMEOUT_MS = 15_000;

test(
  'validated binary downloads ignore proxy environment settings',
  async () => {
    const unreachableProxy = 'http://127.0.0.1:1';
    const child = Bun.spawn(
      [process.execPath, 'run', 'test', 'tests/repositories/binary-source.repository.test.ts'],
      {
        cwd: join(import.meta.dir, '../..'),
        env: {
          ...process.env,
          HTTP_PROXY: unreachableProxy,
          HTTPS_PROXY: unreachableProxy,
          ALL_PROXY: unreachableProxy,
          NO_PROXY: '',
          http_proxy: unreachableProxy,
          https_proxy: unreachableProxy,
          all_proxy: unreachableProxy,
          no_proxy: '',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, `${stdout}\n${stderr}`).toBe(0);
  },
  PROXY_TEST_TIMEOUT_MS,
);

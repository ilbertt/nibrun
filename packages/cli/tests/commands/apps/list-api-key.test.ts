import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('a CI process can use nib without an interactive login', async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(request.headers.get('x-api-key') ?? '');
      return Response.json({ apps: [] });
    },
  });
  try {
    const cli = Bun.spawn({
      cmd: [
        process.execPath,
        fileURLToPath(new URL('../../../src/main.ts', import.meta.url)),
        'apps',
        'list',
        '--json',
      ],
      env: { ...process.env, NIBRUN_API_URL: server.url.origin, NIBRUN_API_KEY: 'nib_ci' },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(cli.stdout).text(),
      new Response(cli.stderr).text(),
      cli.exited,
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ apps: [] });
    expect(requests).toEqual(['nib_ci']);
  } finally {
    server.stop(true);
  }
});

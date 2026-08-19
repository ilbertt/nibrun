import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_PLATFORMS } from '../scripts/release-platforms.ts';

const INSTALL_SH = join(import.meta.dir, '..', 'install.sh');

const EXECUTABLE = 0o755;

// What `uname` answers on machines the CLI is built for. The values are the real ones rather than
// tidy names, because it is exactly their untidiness the script has to absorb.
const MACHINES = [
  { uname: { os: 'Darwin', arch: 'arm64' }, platform: 'darwin-arm64' },
  { uname: { os: 'Linux', arch: 'x86_64' }, platform: 'linux-x64' },
  { uname: { os: 'Linux', arch: 'amd64' }, platform: 'linux-x64' },
  { uname: { os: 'Linux', arch: 'aarch64' }, platform: 'linux-arm64' },
  { uname: { os: 'Linux', arch: 'arm64' }, platform: 'linux-arm64' },
];

const UNSUPPORTED = [
  { uname: { os: 'Darwin', arch: 'x86_64' }, because: 'no darwin-x64 asset is published' },
  { uname: { os: 'Linux', arch: 'riscv64' }, because: 'the architecture is not one we build' },
  { uname: { os: 'FreeBSD', arch: 'x86_64' }, because: 'the operating system is not one we build' },
  { uname: { os: 'MINGW64_NT-10.0', arch: 'x86_64' }, because: 'Windows is not one we build' },
];

const stubDirs: string[] = [];

afterAll(async () => {
  await Promise.all(stubDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('a machine is resolved to the asset built for it', () => {
  for (const { uname, platform } of MACHINES) {
    test(`${uname.os}/${uname.arch} is ${platform}`, async () => {
      const resolved = await resolveTarget(uname);
      expect(resolved.exitCode).toBe(0);
      expect(resolved.stdout).toBe(platform);
    });
  }

  // The two lists are the same fact, so this is what fails when only one of them is added to.
  test('every platform a release carries is reachable from some machine', () => {
    expect(new Set(MACHINES.map(({ platform }) => platform))).toEqual(new Set(RELEASE_PLATFORMS));
  });
});

describe('a machine with no asset is told so rather than sent to a 404', () => {
  for (const { uname, because } of UNSUPPORTED) {
    test(`${uname.os}/${uname.arch}: ${because}`, async () => {
      const resolved = await resolveTarget(uname);
      expect(resolved.exitCode).not.toBe(0);
      expect(resolved.stdout).toBe('');
      expect(resolved.stderr).toContain('install.sh:');
    });
  }
});

/**
 * Runs the real script against a `uname` that answers for the machine being described. Stubbing the
 * command rather than the script is what keeps this a test of the thing an owner actually runs.
 */
async function resolveTarget({ os, arch }: { os: string; arch: string }) {
  const dir = await mkdtemp(join(tmpdir(), 'nib-uname-'));
  stubDirs.push(dir);

  const stub = join(dir, 'uname');
  await Bun.write(stub, `#!/bin/sh\ncase "$1" in\n-s) echo ${os} ;;\n-m) echo ${arch} ;;\nesac\n`);
  await chmod(stub, EXECUTABLE);

  const proc = Bun.spawn(['sh', INSTALL_SH, '--print-target'], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

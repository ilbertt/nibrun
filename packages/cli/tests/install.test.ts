import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
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

// A release invented for the tests, so what they assert on is the script's handling of an answer
// rather than whatever github.com happens to be serving today.
const RELEASE = 'cli-v2026.1.1-1';
const RELEASE_VERSION = '2026.1.1-1';
const RELEASE_MACHINE = { os: 'Linux', arch: 'x86_64' };
const RELEASE_ASSET = 'nib-linux-x64';

// Executable and answers `--version`, which is all the script asks of what it downloads.
const RELEASED_BINARY = `#!/bin/sh\necho ${RELEASE_VERSION}\n`;
const RELEASED_BINARY_SHA256 = new Bun.CryptoHasher('sha256').update(RELEASED_BINARY).digest('hex');

const WRONG_SHA256 = '0'.repeat(RELEASED_BINARY_SHA256.length);

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

describe('a binary is checked against the checksum its release publishes', () => {
  test('one that matches is installed and run', async () => {
    const installed = await runInstall({
      checksums: `${RELEASED_BINARY_SHA256}  ${RELEASE_ASSET}`,
    });

    expect(installed.exitCode).toBe(0);
    expect(installed.entries).toEqual(['nib']);
    expect(installed.binary).toBe(RELEASED_BINARY);
    expect(installed.stderr).toContain(`nib ${RELEASE_VERSION} is installed`);
  });

  test('one that does not is refused, and nothing is left behind', async () => {
    const installed = await runInstall({ checksums: `${WRONG_SHA256}  ${RELEASE_ASSET}` });

    expect(installed.exitCode).not.toBe(0);
    expect(installed.entries).toEqual([]);
    expect(installed.binary).toBeNull();
    expect(installed.stderr).toContain('install.sh:');
    expect(installed.stderr).toContain(RELEASED_BINARY_SHA256);
  });

  // Every release cut before checksums.txt existed is still one NIB_VERSION can name, so a release
  // carrying no checksum has to install rather than fail closed.
  test('a release publishing none is installed anyway, and says so', async () => {
    const installed = await runInstall({ checksums: null });

    expect(installed.exitCode).toBe(0);
    expect(installed.binary).toBe(RELEASED_BINARY);
    expect(installed.stderr).toContain('publishes no checksum');
  });
});

describe('an install outside PATH explains how to use it', () => {
  test('the suggested export works with spaces, quotes, dollars and backslashes in the path', async () => {
    const installed = await runInstall({
      checksums: null,
      installName: "bin with 'quotes' $dollars\\slashes",
    });
    const exported = installed.stderr
      .split('\n')
      .find((line) => line.trim().startsWith('export PATH='));
    expect(exported).toBeDefined();
    const proc = Bun.spawn(['sh', '-c', `${exported}\nnib --version`], {
      env: { PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(await proc.exited).toBe(0);
    expect((await new Response(proc.stdout).text()).trim()).toBe(RELEASE_VERSION);
    expect(installed.stderr).toContain('login');
    expect(installed.stderr).toContain(`${installed.configDir}/.zshrc`);
  });

  test('fish gets a command that applies now and persists', async () => {
    const installed = await runInstall({ checksums: null, shell: '/usr/local/bin/fish' });

    expect(installed.stderr).toContain(`fish_add_path '${installed.installDir}'`);
    expect(installed.stderr).not.toContain('export PATH=');
  });

  test.each([
    { os: 'Linux', arch: 'x86_64', profile: '.bashrc' },
    { os: 'Darwin', arch: 'arm64', profile: '.bash_profile' },
  ])('bash on $os names $profile', async ({ os, arch, profile }) => {
    const installed = await runInstall({
      checksums: null,
      shell: '/bin/bash',
      machine: { os, arch },
    });

    expect(installed.stderr).toContain(`/${profile}'`);
    expect(installed.stderr).toContain('current terminal');
  });
});

/**
 * Runs the real script against a `uname` that answers for the machine being described. Stubbing the
 * command rather than the script is what keeps this a test of the thing an owner actually runs.
 */
async function resolveTarget({ os, arch }: { os: string; arch: string }) {
  const dir = await stubDir();
  await writeStub({ dir, name: 'uname', body: unameStub({ os, arch }) });

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

/**
 * A whole install against a stubbed release: `curl` answers for both the asset and the checksums,
 * and `NIB_VERSION` is what keeps the script from asking github.com which release is newest.
 */
async function runInstall({
  checksums,
  shell = '/bin/zsh',
  installName = 'bin',
  machine = RELEASE_MACHINE,
}: {
  checksums: string | null;
  shell?: string;
  installName?: string;
  machine?: { os: string; arch: string };
}) {
  const dir = await stubDir();
  const installDir = join(dir, installName);
  const configDir = join(dir, 'config');

  await writeStub({ dir, name: 'uname', body: unameStub(machine) });
  await writeStub({ dir, name: 'curl', body: curlStub({ checksums }) });

  const proc = Bun.spawn(['sh', INSTALL_SH], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      NIB_VERSION: RELEASE,
      NIB_INSTALL_DIR: installDir,
      SHELL: shell,
      ZDOTDIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const installed = Bun.file(join(installDir, 'nib'));

  return {
    stdout,
    stderr,
    exitCode,
    installDir,
    configDir,
    binary: (await installed.exists()) ? await installed.text() : null,
    entries: await readdir(installDir),
  };
}

/**
 * Answers the asset with a binary and the checksums with whatever the case under test publishes —
 * `--fail` exiting non-zero being how curl reports the 404 of a release that carries none.
 */
function curlStub({ checksums }: { checksums: string | null }) {
  const answer = checksums === null ? 'exit 22' : `printf '%s\\n' '${checksums}'`;

  return `#!/bin/sh
url=''
out=''
while [ $# -gt 0 ]; do
  case $1 in
    --output) out=$2; shift ;;
    https://*) url=$1 ;;
  esac
  shift
done

case "$url" in
  */checksums.txt) ${answer} ;;
  *)
    cat > "$out" <<'RELEASED'
${RELEASED_BINARY.trimEnd()}
RELEASED
    ;;
esac
`;
}

function unameStub({ os, arch }: { os: string; arch: string }) {
  return `#!/bin/sh\ncase "$1" in\n-s) echo ${os} ;;\n-m) echo ${arch} ;;\nesac\n`;
}

async function stubDir() {
  const dir = await mkdtemp(join(tmpdir(), 'nib-stubs-'));
  stubDirs.push(dir);
  return dir;
}

async function writeStub({ dir, name, body }: { dir: string; name: string; body: string }) {
  const stub = join(dir, name);
  await Bun.write(stub, body);
  await chmod(stub, EXECUTABLE);
}

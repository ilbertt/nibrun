import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hostDirectory = new URL('../../../infra/nibrunner-host/', import.meta.url).pathname;
const tokenParameter = '/nibrun/nibrunner_cloudflared_token';
const token = 'private-tunnel-token';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
let fixtureRoot: string;

beforeEach(function createHostFixture() {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'nibrunner-tunnel-'));
  for (const directory of ['bin', 'run', 'etc/apt/sources.list.d', 'etc/systemd/system']) {
    mkdirSync(join(fixtureRoot, directory), { recursive: true });
  }
  const commands = join(fixtureRoot, 'bin/host-command');
  writeFileSync(
    commands,
    `#!/bin/bash
set -eu
case "$(basename "$0")" in
  aws)
    printf '%s' "$TEST_TUNNEL_TOKEN"
    exit "$TEST_SSM_EXIT_CODE"
    ;;
  curl)
    while [ "$1" != -o ]; do shift; done
    printf key > "$2"
    ;;
  systemctl)
    printf '%s\\n' "$*" >> "$TEST_SYSTEMCTL_LOG"
    case "$1" in
      show) printf '%s\\n' "$TEST_INVOCATION_ID" ;;
      is-active) test -f "$TEST_ACTIVE_MARKER" ;;
      restart) touch "$TEST_ACTIVE_MARKER" ;;
    esac
    ;;
  cloudflared)
    exit "$TEST_READY_EXIT_CODE"
    ;;
esac
`,
    { mode: 0o755 },
  );
  for (const command of ['apt-get', 'aws', 'cloudflared', 'curl', 'flock', 'sleep', 'systemctl']) {
    symlinkSync(commands, join(fixtureRoot, `bin/${command}`));
  }
  const installer = readFileSync(join(hostDirectory, 'deploy/install_tunnel.sh'), 'utf8')
    .replaceAll('/etc/', `${fixtureRoot}/etc/`)
    .replaceAll('/run/', `${fixtureRoot}/run/`)
    .replaceAll('/usr/share/', `${fixtureRoot}/usr/share/`);
  writeFileSync(join(fixtureRoot, 'install_tunnel.sh'), installer);
  writeFileSync(
    join(fixtureRoot, 'nibrun-nibrunner-tunnel.service'),
    readFileSync(join(hostDirectory, 'systemd/nibrun-nibrunner-tunnel.service')),
  );
});

afterEach(function removeHostFixture() {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function runInstall(overrides: Record<string, string>) {
  return Bun.spawnSync(['bash', join(fixtureRoot, 'install_tunnel.sh')], {
    env: {
      ...process.env,
      PATH: `${fixtureRoot}/bin:${process.env.PATH}`,
      AWS_REGION: 'eu-central-1',
      NIBRUNNER_CLOUDFLARED_TOKEN_PARAMETER: tokenParameter,
      TEST_TUNNEL_TOKEN: token,
      TEST_SSM_EXIT_CODE: '0',
      TEST_READY_EXIT_CODE: '0',
      TEST_SYSTEMCTL_LOG: join(fixtureRoot, 'systemctl.log'),
      TEST_ACTIVE_MARKER: join(fixtureRoot, 'service-active'),
      TEST_INVOCATION_ID: 'active-tunnel-generation',
      ...overrides,
    },
  });
}

function installedToken() {
  return readFileSync(join(fixtureRoot, 'etc/nibrunner/cloudflared/token'), 'utf8');
}

test('installs and rotates a private token without putting it in the service or command output', function installsCredentials() {
  const first = runInstall({});
  expect(first.exitCode).toBe(0);
  expect(installedToken()).toBe(token);
  const directory = join(fixtureRoot, 'etc/nibrunner/cloudflared');
  expect(statSync(directory).mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
  expect(statSync(join(directory, 'token')).mode & 0o777).toBe(PRIVATE_FILE_MODE);
  const unit = readFileSync(
    join(fixtureRoot, 'etc/systemd/system/nibrun-nibrunner-tunnel.service'),
    'utf8',
  );
  expect(unit).toContain('LoadCredential=tunnel-token:');
  expect(unit).toContain('--token-file %d/tunnel-token');
  expect(unit).not.toContain(token);
  expect(first.stdout.toString() + first.stderr.toString()).not.toContain(token);

  expect(runInstall({ TEST_TUNNEL_TOKEN: 'rotated-token' }).exitCode).toBe(0);
  expect(installedToken()).toBe('rotated-token');
  expect(readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8')).toContain(
    'restart nibrun-nibrunner-tunnel.service',
  );
});

test('leaves the installed token and service alone when SSM fails or returns an empty token', function preservesWorkingCredentials() {
  expect(runInstall({}).exitCode).toBe(0);
  const log = readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8');
  const failures: Record<string, string>[] = [
    { TEST_SSM_EXIT_CODE: '1', TEST_TUNNEL_TOKEN: 'partial-token' },
    { TEST_TUNNEL_TOKEN: '' },
    { TEST_TUNNEL_TOKEN: 'None' },
  ];
  for (const overrides of failures) {
    expect(runInstall(overrides).exitCode).not.toBe(0);
    expect(installedToken()).toBe(token);
    expect(readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8')).toBe(log);
  }
});

test('fails deployment when the connector cannot reach Cloudflare', function rejectsUnreadyConnector() {
  const result = runInstall({ TEST_READY_EXIT_CODE: '1' });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain('the Cloudflare Tunnel did not become ready');
});

function restartCount() {
  return readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8')
    .split('\n')
    .filter(function restarted(line) {
      return line === 'restart nibrun-nibrunner-tunnel.service';
    }).length;
}

test('keeps a verified unchanged connector running during repeated deployments', function preservesConnections() {
  expect(runInstall({}).exitCode).toBe(0);
  expect(restartCount()).toBe(1);
  expect(runInstall({}).exitCode).toBe(0);
  expect(restartCount()).toBe(1);
});

function expectRestart(overrides: Record<string, string>) {
  const before = restartCount();
  expect(runInstall(overrides).exitCode).toBe(0);
  expect(restartCount()).toBe(before + 1);
}

test('restarts when the token, unit, or connector binary changes', function appliesChangedInputs() {
  expect(runInstall({}).exitCode).toBe(0);
  const rotated = { TEST_TUNNEL_TOKEN: 'rotated-token' };
  expectRestart(rotated);

  const unit = join(fixtureRoot, 'nibrun-nibrunner-tunnel.service');
  writeFileSync(unit, readFileSync(unit, 'utf8').replace('RestartSec=5', 'RestartSec=6'));
  expectRestart(rotated);

  const executable = join(fixtureRoot, 'bin/host-command');
  writeFileSync(executable, `${readFileSync(executable, 'utf8')}\n:\n`);
  expectRestart(rotated);
});

test('retries an activation that failed readiness and recovers an inactive connector', function retriesActivation() {
  expect(runInstall({ TEST_READY_EXIT_CODE: '1' }).exitCode).not.toBe(0);
  expect(runInstall({}).exitCode).toBe(0);
  expect(restartCount()).toBe(2);

  rmSync(join(fixtureRoot, 'service-active'));
  expectRestart({});

  expectRestart({ TEST_INVOCATION_ID: 'unverified-generation' });
});

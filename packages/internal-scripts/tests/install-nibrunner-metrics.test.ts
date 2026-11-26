import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hostDirectory = new URL('../../../infra/nibrunner-host/', import.meta.url).pathname;
let fixtureRoot: string;

beforeEach(function createMetricsHost() {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'nibrunner-metrics-'));
  for (const directory of ['bin', 'run', 'etc/apt/sources.list.d', 'etc/systemd/system']) {
    mkdirSync(join(fixtureRoot, directory), { recursive: true });
  }
  const command = join(fixtureRoot, 'bin/host-command');
  writeFileSync(
    command,
    `#!/bin/bash
set -eu
case "$(basename "$0")" in
  curl)
    if [[ "$*" == *12345/-/ready* ]]; then exit "$TEST_READY_EXIT_CODE"; fi
    while [ "$1" != -o ]; do shift; done
    printf key > "$2"
    ;;
  alloy) exit "$TEST_VALIDATION_EXIT_CODE" ;;
  systemctl)
    printf '%s\\n' "$*" >> "$TEST_SYSTEMCTL_LOG"
    case "$1" in
      show) printf '%s\\n' "$TEST_INVOCATION_ID" ;;
      is-active) test -f "$TEST_ACTIVE_MARKER" ;;
      restart) touch "$TEST_ACTIVE_MARKER" ;;
    esac
    ;;
esac
`,
    { mode: 0o755 },
  );
  for (const name of ['apt-get', 'alloy', 'curl', 'flock', 'sleep', 'systemctl']) {
    symlinkSync(command, join(fixtureRoot, `bin/${name}`));
  }
  const installer = readFileSync(join(hostDirectory, 'deploy/install_metrics.sh'), 'utf8')
    .replaceAll('/etc/', `${fixtureRoot}/etc/`)
    .replaceAll('/run/', `${fixtureRoot}/run/`);
  writeFileSync(join(fixtureRoot, 'install_metrics.sh'), installer);
  writeFileSync(join(fixtureRoot, 'metrics.alloy'), 'logging { level = "info" }');
  writeFileSync(
    join(fixtureRoot, 'nibrun-nibrunner-metrics.service'),
    readFileSync(join(hostDirectory, 'systemd/nibrun-nibrunner-metrics.service')),
  );
});

afterEach(function removeMetricsHost() {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function install(overrides: Record<string, string>) {
  return Bun.spawnSync(['bash', join(fixtureRoot, 'install_metrics.sh')], {
    env: {
      ...process.env,
      PATH: `${fixtureRoot}/bin:${process.env.PATH}`,
      TEST_READY_EXIT_CODE: '0',
      TEST_VALIDATION_EXIT_CODE: '0',
      TEST_SYSTEMCTL_LOG: join(fixtureRoot, 'systemctl.log'),
      TEST_INVOCATION_ID: 'metrics-generation',
      TEST_ACTIVE_MARKER: join(fixtureRoot, 'active'),
      ...overrides,
    },
  });
}

function restarts() {
  return readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8')
    .split('\n')
    .filter(function isCollectorRestart(line) {
      return line === 'restart nibrun-nibrunner-metrics.service';
    }).length;
}

test('keeps a verified unchanged collector running across deployments', function avoidsUnnecessaryRestarts() {
  expect(install({}).exitCode).toBe(0);
  expect(restarts()).toBe(1);
  expect(install({}).exitCode).toBe(0);
  expect(restarts()).toBe(1);
  expect(readFileSync(join(fixtureRoot, 'systemctl.log'), 'utf8')).not.toContain(
    'restart nibrunnerd',
  );
});

test('applies a changed remote-write configuration and recovers an inactive collector', function appliesConfiguration() {
  expect(install({}).exitCode).toBe(0);
  writeFileSync(join(fixtureRoot, 'metrics.alloy'), 'logging { level = "debug" }');
  expect(install({}).exitCode).toBe(0);
  expect(restarts()).toBe(2);
  const beforeRecovery = restarts();
  rmSync(join(fixtureRoot, 'active'));
  expect(install({}).exitCode).toBe(0);
  expect(restarts()).toBe(beforeRecovery + 1);
});

test('preserves the working collector configuration when validation fails', function preservesWorkingConfiguration() {
  expect(install({}).exitCode).toBe(0);
  const configuration = readFileSync(
    join(fixtureRoot, 'etc/nibrunner-metrics/config.alloy'),
    'utf8',
  );
  writeFileSync(join(fixtureRoot, 'metrics.alloy'), 'invalid configuration');
  expect(install({ TEST_VALIDATION_EXIT_CODE: '1' }).exitCode).not.toBe(0);
  expect(readFileSync(join(fixtureRoot, 'etc/nibrunner-metrics/config.alloy'), 'utf8')).toBe(
    configuration,
  );
  expect(restarts()).toBe(1);
});

test('retries a collector that never became ready instead of recording a successful activation', function retriesReadinessFailure() {
  expect(install({ TEST_READY_EXIT_CODE: '1' }).exitCode).not.toBe(0);
  expect(install({}).exitCode).toBe(0);
  expect(restarts()).toBe(2);
});

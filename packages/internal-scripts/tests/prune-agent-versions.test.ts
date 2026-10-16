import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scriptPath = new URL(
  '../../../infra/app-host/deploy/prune_agent_versions.sh',
  import.meta.url,
).pathname;
const HEX_RADIX = 16;
const COMMIT_HASH_LENGTH = 40;
const OLDEST_VERSION = 1;
const RUNNING_VERSION = 2;
const OLDER_ROLLBACK_VERSION = 4;
const NEWER_ROLLBACK_VERSION = 5;
const CURRENT_VERSION = 6;
const LINKED_BINARY_VERSION = 7;
const UNEXPECTED_CONTENTS_VERSION = 8;
const INCOMPLETE_VERSION = 9;
let fixtureRoot: string;

beforeEach(function createHostFixture() {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'nibrun-agent-retention-')));
  mkdirSync(join(fixtureRoot, 'bin'));
  mkdirSync(join(fixtureRoot, 'proc'));
});

afterEach(function removeHostFixture() {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function versionPath(version: number) {
  return join(
    fixtureRoot,
    'versions/agent',
    version.toString(HEX_RADIX).padStart(COMMIT_HASH_LENGTH, '0'),
  );
}

function installVersion(version: number) {
  const directory = versionPath(version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'nibrun-agent'), 'binary');
  writeFileSync(join(directory, '.installed'), '');
  utimesSync(directory, version, version);
  return directory;
}

function activateVersion(version: number) {
  symlinkSync(versionPath(version), join(fixtureRoot, 'bin/agent'));
}

function runPrune() {
  return Bun.spawnSync(['bash', scriptPath, fixtureRoot, join(fixtureRoot, 'proc')]);
}

test('keeps the active version and two newest rollback versions, without touching other components', function retainsRollbackVersions() {
  for (let version = 1; version <= CURRENT_VERSION; version++) {
    installVersion(version);
  }
  activateVersion(CURRENT_VERSION);
  const tenantData = join(fixtureRoot, 'data');
  const firecracker = join(fixtureRoot, 'versions/firecracker/old');
  mkdirSync(tenantData);
  mkdirSync(firecracker, { recursive: true });

  expect(runPrune().exitCode).toBe(0);
  for (let version = 1; version <= CURRENT_VERSION; version++) {
    expect(existsSync(versionPath(version))).toBe(version >= OLDER_ROLLBACK_VERSION);
  }
  expect(existsSync(tenantData)).toBe(true);
  expect(existsSync(firecracker)).toBe(true);
  const repeated = runPrune();
  expect(repeated.exitCode).toBe(0);
  expect(repeated.stdout.toString()).toBe('');
});

test('preserves an older active rollback and an executable still running from another old version', function preservesRunningVersions() {
  for (let version = 1; version <= CURRENT_VERSION; version++) {
    installVersion(version);
  }
  activateVersion(1);
  const processDirectory = join(fixtureRoot, 'proc/123');
  mkdirSync(processDirectory);
  symlinkSync(join(versionPath(2), 'nibrun-agent'), join(processDirectory, 'exe'));
  mkdirSync(join(fixtureRoot, 'proc/456'));

  expect(runPrune().exitCode).toBe(0);
  for (let version = 1; version <= CURRENT_VERSION; version++) {
    expect(existsSync(versionPath(version))).toBe(
      [OLDEST_VERSION, RUNNING_VERSION, NEWER_ROLLBACK_VERSION, CURRENT_VERSION].includes(version),
    );
  }
});

test('does not prune or count incomplete, unexpected, or symlinked installations as rollback versions', function preservesUnexpectedInstallations() {
  for (let version = 1; version <= INCOMPLETE_VERSION; version++) {
    installVersion(version);
  }
  activateVersion(1);
  rmSync(join(versionPath(INCOMPLETE_VERSION), '.installed'));
  writeFileSync(join(versionPath(UNEXPECTED_CONTENTS_VERSION), 'tenant-data'), 'preserve');
  rmSync(join(versionPath(LINKED_BINARY_VERSION), 'nibrun-agent'));
  symlinkSync(
    join(versionPath(1), 'nibrun-agent'),
    join(versionPath(LINKED_BINARY_VERSION), 'nibrun-agent'),
  );
  rmSync(versionPath(CURRENT_VERSION), { recursive: true });
  symlinkSync(versionPath(1), versionPath(CURRENT_VERSION));
  const unexpected = join(fixtureRoot, 'versions/agent/not-a-version');
  mkdirSync(unexpected);
  writeFileSync(join(unexpected, '.installed'), '');
  writeFileSync(join(unexpected, 'nibrun-agent'), 'preserve');

  expect(runPrune().exitCode).toBe(0);
  for (let version = 1; version <= INCOMPLETE_VERSION; version++) {
    expect(existsSync(versionPath(version))).toBe(
      version === 1 || version >= OLDER_ROLLBACK_VERSION,
    );
  }
  expect(existsSync(unexpected)).toBe(true);
});

test('refuses to prune if the active target is missing, outside the version root, or nested inside a version', function rejectsUnsafeActiveTargets() {
  for (let version = 1; version <= NEWER_ROLLBACK_VERSION; version++) {
    installVersion(version);
  }
  expect(runPrune().exitCode).not.toBe(0);
  symlinkSync(fixtureRoot, join(fixtureRoot, 'bin/agent'));
  expect(runPrune().exitCode).not.toBe(0);
  rmSync(join(fixtureRoot, 'bin/agent'));
  mkdirSync(join(versionPath(1), 'nested'));
  symlinkSync(join(versionPath(1), 'nested'), join(fixtureRoot, 'bin/agent'));
  expect(runPrune().exitCode).not.toBe(0);
  for (let version = 1; version <= NEWER_ROLLBACK_VERSION; version++) {
    expect(existsSync(versionPath(version))).toBe(true);
  }
});

test('accepts an empty host and preserves fewer than three installed versions', function acceptsSmallVersionSets() {
  expect(runPrune().exitCode).toBe(0);
  installVersion(1);
  installVersion(2);
  activateVersion(2);
  expect(runPrune().exitCode).toBe(0);
  expect(existsSync(versionPath(1))).toBe(true);
  expect(existsSync(versionPath(2))).toBe(true);
});

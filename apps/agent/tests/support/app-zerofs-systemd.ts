import { dirname, join } from 'node:path';
import { FileSystem } from '@effect/platform';
import { type AppId, AppIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect } from 'effect';
import { parseProperties } from '#lib/systemd-properties.ts';
import { appZerofsPaths } from '#lib/volumes/app-zerofs-config.ts';
import { assertAppZerofsStopped } from '#lib/volumes/app-zerofs-observation.ts';
import { appZerofsUnits, stopAppZerofs } from '#lib/volumes/app-zerofs-systemd.ts';
import { AgentConfig } from '#services/agent-config.service.ts';
import { run, stdoutOf } from '#services/command-runner.service.ts';
import { AGENT_CONFIG, agentConfig } from '#tests/support/config.ts';
import { temporaryDirectory } from '#tests/support/run.ts';
import { zerofsBinary } from '#tests/support/zerofs.ts';

const STATE_DIRECTORY = '/var/lib/nibrun';
const INSTALL_DIRECTORY = '/opt/nibrun';
const UNIT_DIRECTORY = '/run/systemd/system';
const DATA_UNIT = 'nibrun-data.service';
const PUBLIC_FILE_MODE = 0o644;
const PUBLIC_DIRECTORY_MODE = 0o755;
const DATA_UNIT_CONTENTS = '[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/true\n';
const TRUSTED_CERTIFICATE = join(INSTALL_DIRECTORY, 'test-ca.crt');

function systemdInstance() {
  const appId = Value.Parse(AppIdSchema, `systemd-${crypto.randomUUID()}`);
  const paths = appZerofsPaths({ appId, stateDir: STATE_DIRECTORY });
  const units = appZerofsUnits(appId);
  const journal = stdoutOf({
    command: [
      'journalctl',
      '--no-pager',
      '--lines=100',
      ...Object.values(units).flatMap((unit) => ['--unit', unit]),
    ],
  }).pipe(Effect.flatMap(Effect.logError), Effect.ignore);
  return { appId, paths, units, journal };
}

function installAppTrust(appId: AppId) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = join(UNIT_DIRECTORY, `${appZerofsUnits(appId).server}.d`);
    yield* fs.makeDirectory(directory);
    yield* fs.writeFileString(
      join(directory, 'test.conf'),
      `[Service]\nEnvironment=SSL_CERT_FILE=${TRUSTED_CERTIFICATE} NO_PROXY=* no_proxy=*\n`,
      { flag: 'wx', mode: PUBLIC_FILE_MODE },
    );
  });
}

export function additionalAppZerofsInstance() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const instance = systemdInstance();
    const { appId, paths, units } = instance;
    const dropInDirectory = join(UNIT_DIRECTORY, `${units.server}.d`);
    for (const path of [
      paths.cacheDirectory,
      paths.mountPath,
      dirname(paths.configFile),
      dirname(paths.sockets.nbd),
      dropInDirectory,
    ]) {
      if (yield* fs.exists(path)) {
        return yield* Effect.fail(
          new Error('The systemd instance fixture refuses existing app files.'),
        );
      }
    }
    for (const unit of Object.values(units)) {
      const output = yield* stdoutOf({
        command: ['systemctl', 'show', unit, '--property=ActiveState,MainPID,FragmentPath'],
      });
      const state = parseProperties(output);
      if (
        state.ActiveState !== 'inactive' ||
        state.MainPID !== '0' ||
        state.FragmentPath !== join(UNIT_DIRECTORY, unit.replace(appId, ''))
      ) {
        return yield* Effect.fail(
          new Error('The systemd instance fixture requires unused installed templates.'),
        );
      }
    }
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* stopAppZerofs(appId);
        yield* run({ command: ['systemctl', 'reset-failed', ...Object.values(units)] });
        yield* assertAppZerofsStopped(appId);
        if (
          (yield* run({ command: ['mountpoint', '--quiet', '--', paths.mountPath] })).code === 0
        ) {
          yield* stdoutOf({ command: ['fusermount3', '-u', paths.mountPath] });
        }
        yield* fs.remove(dropInDirectory, { force: true, recursive: true });
        yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
      }).pipe(Effect.orDie),
    );
    yield* installAppTrust(appId);
    yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
    return instance;
  });
}

export function emptySharedMount() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { zerofsMount } = yield* AgentConfig;
    if (yield* fs.exists(zerofsMount)) {
      return yield* Effect.fail(new Error('The shared-mount fixture refuses an existing path.'));
    }
    yield* fs.makeDirectory(zerofsMount);
    yield* Effect.addFinalizer(() =>
      fs.remove(zerofsMount, { recursive: true }).pipe(Effect.orDie),
    );
    yield* Effect.acquireRelease(
      stdoutOf({
        command: [
          'mount',
          '-t',
          'tmpfs',
          '-o',
          'size=1M,nodev,nosuid,noexec',
          'tmpfs',
          zerofsMount,
        ],
      }),
      () => stdoutOf({ command: ['umount', '--', zerofsMount] }).pipe(Effect.orDie),
    );
    return zerofsMount;
  });
}

function requireDisposableHost({
  directories,
  units,
}: {
  directories: readonly string[];
  units: readonly string[];
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    for (const directory of directories) {
      if (yield* fs.exists(directory)) {
        return yield* Effect.fail(new Error('The systemd fixture refuses existing host files.'));
      }
    }
    for (const unit of units) {
      const state = yield* run({
        command: ['systemctl', 'show', unit, '--property=LoadState', '--value'],
      });
      if (state.stdout.trim() !== 'not-found') {
        return yield* Effect.fail(new Error('The systemd fixture requires unused host units.'));
      }
    }
    for (const database of ['passwd', 'group']) {
      if ((yield* run({ command: ['getent', database, 'zerofs'] })).code === 0) {
        return yield* Effect.fail(
          new Error('The systemd fixture requires an unused zerofs account.'),
        );
      }
    }
  });
}

function removeHost({
  appId,
  directories,
  unitFiles,
}: {
  appId: AppId;
  directories: readonly string[];
  unitFiles: readonly string[];
}) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const units = appZerofsUnits(appId);
    yield* run({ command: ['systemctl', 'stop', units.mount, units.server, DATA_UNIT] });
    yield* run({ command: ['systemctl', 'reset-failed', units.mount, units.server, DATA_UNIT] });
    for (const unit of [...Object.values(units), DATA_UNIT]) {
      const result = yield* run({
        command: ['systemctl', 'show', unit, '--property=LoadState,ActiveState,SubState'],
      });
      const state = parseProperties(result.stdout);
      if (
        state.LoadState !== 'not-found' &&
        (state.ActiveState !== 'inactive' || state.SubState !== 'dead')
      ) {
        return yield* Effect.fail(new Error('The systemd fixture still has a running service.'));
      }
    }
    yield* Effect.forEach(unitFiles, (path) => fs.remove(path, { force: true, recursive: true }));
    yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
    const paths = appZerofsPaths({ appId, stateDir: STATE_DIRECTORY });
    if ((yield* run({ command: ['mountpoint', '--quiet', '--', paths.mountPath] })).code === 0) {
      yield* stdoutOf({ command: ['fusermount3', '-u', paths.mountPath] });
    }
    if ((yield* run({ command: ['mountpoint', '--quiet', '--', '/data'] })).code === 0) {
      yield* stdoutOf({ command: ['umount', '--', '/data'] });
    }
    if ((yield* run({ command: ['getent', 'passwd', 'zerofs'] })).code === 0) {
      yield* stdoutOf({ command: ['userdel', 'zerofs'] });
    }
    if ((yield* run({ command: ['getent', 'group', 'zerofs'] })).code === 0) {
      yield* stdoutOf({ command: ['groupdel', 'zerofs'] });
    }
    yield* Effect.forEach(directories, (path) => fs.remove(path, { force: true, recursive: true }));
  });
}

export function appZerofsSystemdHost(certificate: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const binary = yield* zerofsBinary();
    const { appId, paths, units, journal } = systemdInstance();
    const templateNames = Object.values(units).map((unit) => unit.replace(appId, ''));
    const dropInDirectory = join(UNIT_DIRECTORY, `${units.server}.d`);
    const unitFiles = [
      ...templateNames.map((unit) => join(UNIT_DIRECTORY, unit)),
      join(UNIT_DIRECTORY, DATA_UNIT),
      dropInDirectory,
    ];
    const directories = [
      INSTALL_DIRECTORY,
      STATE_DIRECTORY,
      dirname(paths.mountPath),
      dirname(dirname(paths.sockets.nbd)),
      '/data',
    ];
    yield* requireDisposableHost({
      directories: [...directories, ...unitFiles],
      units: [...Object.values(units), DATA_UNIT],
    });
    const data = yield* temporaryDirectory;
    yield* fs.chmod(data, PUBLIC_DIRECTORY_MODE);
    yield* Effect.addFinalizer(() =>
      removeHost({ appId, directories, unitFiles }).pipe(Effect.orDie),
    );
    yield* stdoutOf({
      command: [
        'useradd',
        '--system',
        '--user-group',
        '--no-create-home',
        '--shell',
        '/usr/sbin/nologin',
        'zerofs',
      ],
    });
    yield* fs.makeDirectory('/data');
    yield* stdoutOf({ command: ['mount', '--bind', data, '/data'] });
    yield* fs.makeDirectory(dirname(AGENT_CONFIG.zerofsBinary), { recursive: true });
    yield* stdoutOf({
      command: ['install', '--mode=0755', '--', binary, AGENT_CONFIG.zerofsBinary],
    });
    yield* stdoutOf({
      command: ['install', '--mode=0644', '--', certificate, TRUSTED_CERTIFICATE],
    });
    for (const name of templateNames) {
      const contents = yield* Effect.promise(() =>
        Bun.file(new URL(`../../../../infra/app-host/systemd/${name}`, import.meta.url)).text(),
      );
      yield* fs.writeFileString(join(UNIT_DIRECTORY, name), contents, {
        flag: 'wx',
        mode: PUBLIC_FILE_MODE,
      });
    }
    yield* fs.writeFileString(join(UNIT_DIRECTORY, DATA_UNIT), DATA_UNIT_CONTENTS, {
      flag: 'wx',
      mode: PUBLIC_FILE_MODE,
    });
    yield* installAppTrust(appId);
    yield* stdoutOf({ command: ['systemctl', 'daemon-reload'] });
    return {
      appId,
      paths,
      units,
      journal,
      config: agentConfig({
        stateDir: STATE_DIRECTORY,
        slotsFile: join(STATE_DIRECTORY, 'slots.json'),
        slotCursorFile: join(STATE_DIRECTORY, 'slot-cursor.json'),
        desiredStateFile: join(STATE_DIRECTORY, 'desired-state.json'),
      }),
    };
  });
}

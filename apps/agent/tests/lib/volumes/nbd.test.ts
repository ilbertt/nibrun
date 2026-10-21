import { describe, expect, test } from 'bun:test';
import { basename } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { VolumeIdSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Effect, Either, Layer } from 'effect';
import { CommandTimedOut } from '#lib/exec.ts';
import {
  attach,
  attachCheckpoint,
  attachmentLock,
  attachmentScope,
  detachVerified,
  inspectAttachment,
  isUsable,
  isUsableFor,
  NBD_CLIENT,
  reattach,
  reattachVerified,
} from '#lib/volumes/nbd.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';
import { privateNbdProcess } from '#tests/support/nbd.ts';

const DEVICE = '/dev/nbd0';
const SOCKET = '/run/zerofs/nbd.sock';
const VOLUME_ID = Value.Parse(VolumeIdSchema, '0198f3aa-1c2d-7e4b-9f11-a0b1c2d3e4f5');

const READ_FAILED = 1;
const SYSFS = `/sys/block/${basename(DEVICE)}`;
/** 8 GiB, in the 512-byte sectors `size` is published in. */
const ATTACHED_SECTORS = '16777216\n';
/** What the kernel publishes for a device nothing is attached to, and what a detach restores. */
const DETACHED_SECTORS = '0\n';

/** Present exactly while a client holds the device, which is what makes its presence the answer. */
const attached: Readonly<Record<string, string>> = {
  [`${SYSFS}/pid`]: '4213\n',
  [`${SYSFS}/size`]: ATTACHED_SECTORS,
};

const target = { socketPath: SOCKET, devicePath: DEVICE, volumeId: VOLUME_ID };
const verifiedTarget = { ...target, client: NBD_CLIENT };

const isProbe = (command: readonly string[]) => command[0] === 'dd';
const isDetach = (command: readonly string[]) => command.includes('-d');

function sysfs(attributes: Readonly<Record<string, string>>) {
  return FileSystem.layerNoop({
    exists: (path) => Effect.succeed(path in attributes),
    makeDirectory: () => Effect.void,
    readFileString: (path: string) => {
      const value = attributes[path];
      return value === undefined
        ? Effect.fail(
            new SystemError({
              reason: 'NotFound',
              module: 'FileSystem',
              method: 'readFileString',
              pathOrDescriptor: path,
            }),
          )
        : Effect.succeed(value);
    },
  });
}

function running<R>(layer: Layer.Layer<R>) {
  return function once<A, E>(effect: Effect.Effect<A, E, R>) {
    return Effect.runPromise(Effect.provide(effect, layer));
  };
}

/** A host with the kernel answering about the device, and every subprocess it starts recorded. */
function host({
  attributes = attached,
  answer,
}: {
  attributes?: Readonly<Record<string, string>>;
  answer?: Parameters<typeof recordingCommands>[0];
} = {}) {
  const { commands, layer } = recordingCommands(answer);
  return { commands, run: running(Layer.merge(layer, sysfs(attributes))) };
}

describe('a device that answers is not the same as a device with a client', () => {
  test('liveness is a read, because a read is what a dead device fails', async () => {
    const { commands, run } = host();
    await run(isUsable(DEVICE));
    const probe = commands.find(({ command }) => isProbe(command));
    expect(probe?.command).toContain(`if=${DEVICE}`);
  });

  // Without O_DIRECT the host answers out of its own page cache for a device that has been dead
  // for hours, which is the same false yes this exists to replace.
  test('the read bypasses the page cache', async () => {
    const { commands, run } = host();
    await run(isUsable(DEVICE));
    expect(commands.find(({ command }) => isProbe(command))?.command).toContain('iflag=direct');
  });

  test('a probe that reads is usable', async () => {
    const { run } = host();
    expect(await run(isUsable(DEVICE))).toBe(true);
  });

  // The regression this file exists for. A detached nbd device is zero bytes long, and reading
  // one block of a zero-length device is not an error — `dd` reports `0+0 records in` and exits
  // 0. Asking only whether the read succeeded answered yes for every device on a host that had
  // just rebooted, so nothing was ever attached and no tenant started.
  test('a detached device is not usable, however happily a read of it returns', async () => {
    const { commands, run } = host({ attributes: { [`${SYSFS}/size`]: DETACHED_SECTORS } });
    expect(await run(isUsable(DEVICE))).toBe(false);
    expect(commands.some(({ command }) => isProbe(command))).toBe(false);
  });

  test('a size that cannot be read at all is not usable', async () => {
    const { run } = host({ attributes: {} });
    expect(await run(isUsable(DEVICE))).toBe(false);
  });

  test('a size that is not a number is not usable', async () => {
    const { run } = host({ attributes: { [`${SYSFS}/size`]: 'not a number\n' } });
    expect(await run(isUsable(DEVICE))).toBe(false);
  });

  test('a probe that cannot read is not usable, however healthy the device claims to be', async () => {
    const { run } = host({ answer: () => succeeding({ code: READ_FAILED }) });
    expect(await run(isUsable(DEVICE))).toBe(false);
  });

  // The probe is bounded, so a device that never answers is a device this says no about rather
  // than one it waits on — a reconcile held open behind it would stop every other app's.
  test('a probe that could not be run at all is not evidence of health', async () => {
    const { run } = host({ answer: () => Effect.fail(new Error('spawn failed') as never) });
    expect(await run(isUsable(DEVICE))).toBe(false);
  });

  test('the probe carries a timeout, so it cannot hold the reconcile open', async () => {
    const { commands, run } = host();
    await run(isUsable(DEVICE));
    for (const request of commands) {
      expect(request.timeout).toBeDefined();
    }
  });
});

describe('what may be asked about a device without opening it', () => {
  // The outage. A ZeroFS restart left every device attached with a live client pid and a size the
  // kernel still reported, and every read of one queued forever. `blockdev --getsize64` was how
  // the size was read, so asking the cheap question was itself the thing that hung — in
  // uninterruptible sleep, which no timeout and no signal ends.
  test('the size comes from the kernel, so a device that will not answer is still measured', async () => {
    const { commands, run } = host();
    await run(isUsable(DEVICE));
    expect(commands.some(({ command }) => command[0] === 'blockdev')).toBe(false);
  });

  test('nothing but the probe opens the device', async () => {
    const { commands, run } = host();
    await run(isUsable(DEVICE));
    expect(commands.map(({ command }) => command[0])).toEqual(['dd']);
  });

  // A device nothing is attached to is the common case on a host that has just booted, and it is
  // answered without a single process being started.
  test('a device the kernel says is empty is judged without running anything', async () => {
    const { commands, run } = host({ attributes: { [`${SYSFS}/size`]: DETACHED_SECTORS } });
    await run(isUsable(DEVICE));
    expect(commands).toHaveLength(0);
  });

  test('a device with a live client that still does not answer is not usable', async () => {
    const { run } = host({
      answer: (request) => Effect.fail(new CommandTimedOut({ command: request.command })),
    });
    expect(await run(isUsable(DEVICE))).toBe(false);
  });
});

describe('repairing a device the kernel still holds', () => {
  test('shared and checkpoint clients retain their original arguments', async () => {
    const { commands, run } = host();
    await run(attach(target));
    await run(attachCheckpoint(target));
    expect(commands.map(({ command }) => command)).toEqual([
      [
        'nbd-client',
        '-unix',
        SOCKET,
        DEVICE,
        '-N',
        VOLUME_ID,
        '-persist',
        '-timeout',
        '600',
        '-connections',
        '4',
        '-block-size',
        '4096',
      ],
      [
        'nbd-client',
        '-unix',
        SOCKET,
        DEVICE,
        '-N',
        VOLUME_ID,
        '-timeout',
        '600',
        '-connections',
        '4',
        '-block-size',
        '4096',
      ],
    ]);
  });
  test('a held device is taken down before it is brought up', async () => {
    const { commands, run } = host();
    await run(Effect.ignore(reattach(target)));
    const shapes = commands.map(({ command }) => command);
    expect(isDetach(shapes[0] ?? [])).toBe(true);
    expect(shapes[1]).toContain('-persist');
  });

  // Attaching over a device the kernel is holding finds the minor busy; only a detach frees it.
  test('the detach is what makes the attach able to succeed', async () => {
    const { commands, run } = host();
    await run(Effect.ignore(reattach(target)));
    const detachAt = commands.findIndex(({ command }) => isDetach(command));
    const attachAt = commands.findIndex(({ command }) => command.includes('-persist'));
    expect(detachAt).toBeGreaterThanOrEqual(0);
    expect(attachAt).toBeGreaterThan(detachAt);
  });

  test('a device nobody has attached is attached without a detach first', async () => {
    const { commands, run } = host({ attributes: { [`${SYSFS}/size`]: DETACHED_SECTORS } });
    await run(Effect.ignore(reattach(target)));
    expect(commands.some(({ command }) => isDetach(command))).toBe(false);
    expect(commands.some(({ command }) => command.includes('-persist'))).toBe(true);
  });

  test('a detach that fails does not stop the attach', async () => {
    const { commands, run } = host({
      answer: (request) =>
        isDetach(request.command) ? Effect.fail(new Error('busy') as never) : succeeding(),
    });
    await run(Effect.ignore(reattach(target)));
    expect(commands.some(({ command }) => command.includes('-persist'))).toBe(true);
  });

  test('the volume is named on the way back up, so the device serves the right export', async () => {
    const { commands, run } = host();
    await run(Effect.ignore(reattach(target)));
    const attach = commands.find(({ command }) => command.includes('-persist'));
    expect(attach?.command).toContain(VOLUME_ID);
    expect(attach?.command).toContain(SOCKET);
  });

  // The ceiling the kernel enforces on a request nothing in userspace can take back, and the only
  // reason a process sleeping on a dead device is ever freed without a detach.
  test('an attached device carries a request timeout', async () => {
    const { commands, run } = host();
    await run(Effect.ignore(reattach(target)));
    expect(commands.find(({ command }) => command.includes('-persist'))?.command).toContain(
      '-timeout',
    );
  });
});

function privateAttachment(other: typeof target = target) {
  const process = privateNbdProcess(other);
  return {
    ...attached,
    '/proc/4213/cmdline': process.cmdline,
    '/proc/4213/cgroup': process.cgroup,
  };
}

describe('identifying the live NBD export', () => {
  test('an interrupted setup scope is stopped even before it publishes a kernel owner', async () => {
    const { commands, run } = host({
      attributes: {
        [`/sys/fs/cgroup/system.slice/${attachmentScope(target)}`]: '',
      },
    });
    await run(detachVerified(target));
    expect(commands.map(({ command }) => command)).toEqual([
      ['systemctl', 'stop', attachmentScope(target)],
    ]);
  });
  test('an unassigned device has no verified attachment', async () => {
    const { commands, run } = host({ attributes: {} });
    expect(await run(inspectAttachment(target))).toBe(false);
    expect(commands).toEqual([]);
  });

  test('a healthy legacy device is never accepted, probed or detached as a private export', async () => {
    const { commands, run } = host();
    expect(await run(isUsableFor(target))).toBe(false);
    const result = await run(Effect.either(reattachVerified(verifiedTarget)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentMismatch');
    expect(commands).toEqual([]);
  });

  test('a reused netlink setup PID cannot impersonate a live ioctl owner', async () => {
    const { commands, run } = host({
      attributes: {
        ...privateAttachment(),
        [`${SYSFS}/backend`]: '',
      },
    });
    const result = await run(Effect.either(inspectAttachment(target)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentMismatch');
    expect(await run(isUsableFor(target))).toBe(false);
    expect(commands).toEqual([]);
  });

  test.each([
    { ...target, socketPath: '/run/another/nbd.sock' },
    { ...target, devicePath: '/dev/nbd1' },
    { ...target, volumeId: Value.Parse(VolumeIdSchema, 'another-volume') },
  ])('another socket, device or export is never detached: %j', async (other) => {
    const { commands, run } = host({ attributes: privateAttachment(other) });
    const result = await run(Effect.either(detachVerified(verifiedTarget)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentMismatch');
    expect(commands).toEqual([]);
  });

  test.each([
    { '/proc/4213/cgroup': '0::/system.slice/nibrun-agent.service\n' },
    { '/proc/4213/cmdline': privateNbdProcess(target).cmdline.slice(0, -1) },
    { '/proc/4213/cmdline': privateNbdProcess(target).cmdline.replace('-nonetlink', '-nofork') },
    { [`${SYSFS}/pid`]: '../123' },
  ])('unproven ownership is never probed or detached: %j', async (changed) => {
    const { commands, run } = host({ attributes: { ...privateAttachment(), ...changed } });
    expect(await run(isUsableFor(target))).toBe(false);
    expect(Either.isLeft(await run(Effect.either(detachVerified(verifiedTarget))))).toBe(true);
    expect(commands).toEqual([]);
  });

  test('a PID that changes while ownership is inspected cannot prove an attachment', async () => {
    const attributes = privateAttachment();
    let reads = 0;
    const files = FileSystem.layerNoop({
      readFileString: (path) => {
        if (path === `${SYSFS}/pid`) {
          return Effect.succeed(++reads === 1 ? '4213' : '9999');
        }
        const value = attributes[path as keyof typeof attributes];
        return value === undefined
          ? Effect.fail(
              new SystemError({
                module: 'FileSystem',
                method: 'readFileString',
                reason: 'NotFound',
              }),
            )
          : Effect.succeed(value);
      },
    });
    const result = await running(files)(Effect.either(inspectAttachment(target)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentMismatch');
  });

  test('a restarted agent can verify the live client without an in-memory receipt', async () => {
    const { commands, run } = host({ attributes: privateAttachment() });
    expect(await run(inspectAttachment(target))).toBe(true);
    expect(await run(isUsableFor(target))).toBe(true);
    expect(commands.map(({ command }) => command[0])).toEqual(['dd']);
  });

  test('a new stock-client attachment runs in an independent scope and verifies its live owner', async () => {
    const attributes: Record<string, string> = {};
    const { commands, run } = host({
      attributes,
      answer: () =>
        Effect.sync(() => {
          Object.assign(attributes, privateAttachment());
          return { code: 0, stdout: '', stderr: '' };
        }),
    });
    await run(reattachVerified(verifiedTarget));
    expect(commands.map(({ command }) => command[0])).toEqual(['flock', 'dd']);
    expect(commands[0]?.command).toEqual([
      'flock',
      '--exclusive',
      '--nonblock',
      '--no-fork',
      attachmentLock(target),
      'systemd-run',
      '--scope',
      '--quiet',
      '--collect',
      '--slice=system.slice',
      `--unit=${attachmentScope(target)}`,
      '--',
      NBD_CLIENT,
      ...privateNbdProcess(target).cmdline.split('\0').slice(1, -1),
    ]);
    expect(commands[0]?.command).not.toContain('-identifier');
    expect(commands[0]?.command).not.toContain('--wait');
  });

  test('repair disconnects only the verified ioctl owner before starting its replacement', async () => {
    const attributes: Record<string, string> = privateAttachment();
    const { commands, run } = host({
      attributes,
      answer: ({ command }) =>
        Effect.sync(() => {
          if (command[0] === 'systemctl') {
            for (const path of Object.keys(attributes)) {
              delete attributes[path];
            }
          } else {
            Object.assign(attributes, privateAttachment());
          }
          return { code: 0, stdout: '', stderr: '' };
        }),
    });
    await run(reattachVerified(verifiedTarget));
    expect(commands[0]?.command).toEqual(['systemctl', 'stop', attachmentScope(target)]);
    expect(commands[1]?.command[0]).toBe('flock');
  });

  test('a failed verified detach never reconnects and hides subprocess output', async () => {
    const { commands, run } = host({
      attributes: privateAttachment(),
      answer: () => succeeding({ code: 1, stderr: 'private-server-output' }),
    });
    const result = await run(Effect.either(reattachVerified(verifiedTarget)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
    expect(JSON.stringify(result)).not.toContain('private-server-output');
    expect(commands.map(({ command }) => command)).toEqual([
      ['systemctl', 'stop', attachmentScope(target)],
    ]);
  });

  test('a failed scoped client never falls back to another connection method', async () => {
    const { commands, run } = host({ attributes: {}, answer: () => succeeding({ code: 1 }) });
    const result = await run(Effect.either(reattachVerified(verifiedTarget)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
    expect(commands.map(({ command }) => command[0])).toEqual(['flock']);
  });

  test('a client exit code alone cannot prove an attachment', async () => {
    const { commands, run } = host({ attributes: {} });
    const result = await run(Effect.either(reattachVerified(verifiedTarget)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
    expect(commands.map(({ command }) => command[0])).toEqual(['flock']);
  });

  test('unreadable kernel metadata is an error rather than evidence that the device is free', async () => {
    const files = FileSystem.layerNoop({
      readFileString: () =>
        Effect.fail(
          new SystemError({
            module: 'FileSystem',
            method: 'readFileString',
            reason: 'PermissionDenied',
          }),
        ),
    });
    const result = await running(files)(Effect.either(inspectAttachment(target)));
    expect(Either.isLeft(result) && result.left._tag).toBe('NbdAttachmentUnavailable');
  });
});

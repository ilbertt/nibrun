import { describe, expect, test } from 'bun:test';
import { basename } from 'node:path';
import { FileSystem } from '@effect/platform';
import { SystemError } from '@effect/platform/Error';
import { Value, VolumeIdSchema } from '@repo/protocol';
import { Effect, Layer } from 'effect';
import { CommandTimedOut } from '#lib/exec.ts';
import { isUsable, reattach } from '#lib/volumes/nbd.ts';
import type { CommandRunner } from '#services/command-runner.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';

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

const isProbe = (command: readonly string[]) => command[0] === 'dd';
const isDetach = (command: readonly string[]) => command.includes('-d');

function sysfs(attributes: Readonly<Record<string, string>>) {
  return FileSystem.layerNoop({
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

type Host = CommandRunner | FileSystem.FileSystem;

function running(layer: Layer.Layer<Host>) {
  return function once<A>(effect: Effect.Effect<A, never, Host>) {
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

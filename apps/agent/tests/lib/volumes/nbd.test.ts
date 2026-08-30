import { describe, expect, test } from 'bun:test';
import { Value, VolumeIdSchema } from '@repo/protocol';
import { Effect } from 'effect';
import { isUsable, reattach } from '#lib/volumes/nbd.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';

const DEVICE = '/dev/nbd0';
const SOCKET = '/run/zerofs/nbd.sock';
const VOLUME_ID = Value.Parse(VolumeIdSchema, '0198f3aa-1c2d-7e4b-9f11-a0b1c2d3e4f5');

const READ_FAILED = 1;
const NOT_ATTACHED = 1;

const target = { socketPath: SOCKET, devicePath: DEVICE, volumeId: VOLUME_ID };

const isProbe = (command: readonly string[]) => command[0] === 'dd';
const isCheck = (command: readonly string[]) => command.includes('-check');
const isDetach = (command: readonly string[]) => command.includes('-d');

function run<A>(effect: Effect.Effect<A, never, never>) {
  return Effect.runPromise(effect);
}

describe('a device that answers is not the same as a device with a client', () => {
  test('liveness is a read, because a read is what a dead device fails', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(isUsable(DEVICE), layer));
    expect(commands).toHaveLength(1);
    expect(isProbe(commands[0]?.command ?? [])).toBe(true);
    expect(commands[0]?.command).toContain(`if=${DEVICE}`);
  });

  // Without O_DIRECT the host answers out of its own page cache for a device that has been dead
  // for hours, which is the same false yes this exists to replace.
  test('the read bypasses the page cache', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(isUsable(DEVICE), layer));
    expect(commands[0]?.command).toContain('iflag=direct');
  });

  test('a probe that reads is usable', async () => {
    const { layer } = recordingCommands(() => succeeding());
    expect(await run(Effect.provide(isUsable(DEVICE), layer))).toBe(true);
  });

  test('a probe that cannot read is not usable, however healthy the device claims to be', async () => {
    const { layer } = recordingCommands(() => succeeding({ code: READ_FAILED }));
    expect(await run(Effect.provide(isUsable(DEVICE), layer))).toBe(false);
  });

  // The probe is bounded, so a device that never answers is a device this says no about rather
  // than one it waits on — a reconcile held open behind it would stop every other app's.
  test('a probe that could not be run at all is not evidence of health', async () => {
    const { layer } = recordingCommands(() => Effect.fail(new Error('spawn failed') as never));
    expect(await run(Effect.provide(isUsable(DEVICE), layer))).toBe(false);
  });

  test('the probe carries a timeout, so it cannot hold the reconcile open', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(isUsable(DEVICE), layer));
    expect(commands[0]?.timeout).toBeDefined();
  });
});

describe('repairing a device the kernel still holds', () => {
  test('a held device is taken down before it is brought up', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(Effect.ignore(reattach(target)), layer));
    const shapes = commands.map(({ command }) => command);
    expect(isCheck(shapes[0] ?? [])).toBe(true);
    expect(isDetach(shapes[1] ?? [])).toBe(true);
    expect(shapes[2]).toContain('-persist');
  });

  // Attaching over a device the kernel is holding finds the minor busy; only a detach frees it.
  test('the detach is what makes the attach able to succeed', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(Effect.ignore(reattach(target)), layer));
    const detachAt = commands.findIndex(({ command }) => isDetach(command));
    const attachAt = commands.findIndex(({ command }) => command.includes('-persist'));
    expect(detachAt).toBeGreaterThanOrEqual(0);
    expect(attachAt).toBeGreaterThan(detachAt);
  });

  test('a device nobody has attached is attached without a detach first', async () => {
    const { commands, layer } = recordingCommands((request) =>
      isCheck(request.command) ? succeeding({ code: NOT_ATTACHED }) : succeeding(),
    );
    await run(Effect.provide(Effect.ignore(reattach(target)), layer));
    expect(commands.some(({ command }) => isDetach(command))).toBe(false);
    expect(commands.some(({ command }) => command.includes('-persist'))).toBe(true);
  });

  test('a detach that fails does not stop the attach', async () => {
    const { commands, layer } = recordingCommands((request) =>
      isDetach(request.command) ? Effect.fail(new Error('busy') as never) : succeeding(),
    );
    await run(Effect.provide(Effect.ignore(reattach(target)), layer));
    expect(commands.some(({ command }) => command.includes('-persist'))).toBe(true);
  });

  test('the volume is named on the way back up, so the device serves the right export', async () => {
    const { commands, layer } = recordingCommands(() => succeeding());
    await run(Effect.provide(Effect.ignore(reattach(target)), layer));
    const attached = commands.find(({ command }) => command.includes('-persist'));
    expect(attached?.command).toContain(VOLUME_ID);
    expect(attached?.command).toContain(SOCKET);
  });
});

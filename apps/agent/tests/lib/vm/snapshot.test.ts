import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { DeploymentIdSchema, Value } from '@repo/protocol';
import { Effect, Option } from 'effect';
import { writeJsonFile } from '#lib/json-store.ts';
import {
  driftFrom,
  ensureLoadable,
  readStamp,
  refusalToSleep,
  SNAPSHOT_STAMP_FILENAME,
  type SnapshotStamp,
  snapshotPaths,
} from '#lib/vm/snapshot.ts';
import { APP_ID, DEPLOYMENT_ID } from '#tests/support/fixtures.ts';
import { platform, provided, temporaryDirectory } from '#tests/support/run.ts';

const run = provided(platform);

const SLOT = 7;
const OTHER_DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'dep-2');

const stamp: SnapshotStamp = {
  deploymentId: DEPLOYMENT_ID,
  guestImageVersion: '2026.08.01',
  hostBootId: 'b6b8f0d2-0000-4000-8000-000000000001',
  slot: SLOT,
};

const stampedIn = (directory: string) => join(directory, SNAPSHOT_STAMP_FILENAME);

test('a snapshot is three files under the app it belongs to', () => {
  const paths = snapshotPaths({ snapshotDir: '/data/nibrun-vm', appId: APP_ID });
  expect(paths.directory).toBe(`/data/nibrun-vm/${APP_ID}`);
  expect(paths.stampPath).toBe(stampedIn(paths.directory));
  expect(
    [paths.statePath, paths.memoryPath].every((file) => file.startsWith(paths.directory)),
  ).toBe(true);
});

// A stamp is host-local state some earlier agent wrote, so anything but the shape this one reads
// has to come back as no stamp at all — which is a cold boot rather than a guessed restore.
describe('a stamp is read back only when it is whole', () => {
  test('a complete one round-trips', () => {
    expect(readStamp(JSON.parse(JSON.stringify(stamp)))).toEqual(Option.some(stamp));
  });

  test('a missing field is no stamp', () => {
    expect(readStamp({ ...stamp, hostBootId: undefined })).toEqual(Option.none());
  });

  test('neither is a slot that came back as text', () => {
    expect(readStamp({ ...stamp, slot: String(SLOT) })).toEqual(Option.none());
  });
});

// Each of these is a way the files a snapshot names get replaced underneath it, and Firecracker
// restores drive paths out of the vmstate without checking any of them.
describe('every way a snapshot stops being loadable is named', () => {
  test('an identical stamp has not drifted', () => {
    expect(driftFrom({ stored: stamp, expected: stamp })).toBeUndefined();
  });

  test('a redeploy has replaced the artifact image and the instance config', () => {
    expect(
      driftFrom({ stored: { ...stamp, deploymentId: OTHER_DEPLOYMENT_ID }, expected: stamp }),
    ).toContain('deployed again');
  });

  test('a guest image change has moved the kernel and the rootfs under one path', () => {
    expect(
      driftFrom({ stored: { ...stamp, guestImageVersion: '2026.09.01' }, expected: stamp }),
    ).toContain('guest image');
  });

  test('a reboot has renumbered the NBD devices', () => {
    expect(driftFrom({ stored: { ...stamp, hostBootId: 'another' }, expected: stamp })).toContain(
      'rebooted',
    );
  });

  test('a moved slot has taken the tap, the address and the MAC with it', () => {
    expect(driftFrom({ stored: { ...stamp, slot: SLOT + 1 }, expected: stamp })).toContain(
      'another slot',
    );
  });
});

// Both refusals are about surviving the wake, not about whether sleeping is a good idea — and
// both are enforced against the agent's own record rather than asked of the caller, because the
// caller is the part that changes.
describe('the moments a microVM must not be snapshotted', () => {
  const sleepable = { stopRequested: false, desiredRunning: true, everHealthy: true };

  // The bar is having answered, not being well now: the dangerous window closed the first time
  // the tenant accepted a connection, and going unhealthy since does not reopen it.
  test('an app that has answered at least once is sleepable', () => {
    expect(refusalToSleep(sleepable)).toBeUndefined();
  });

  // `clock_realtime` moves CLOCK_MONOTONIC forward with the clocksource, so the guest
  // supervisor's SIGTERM-to-SIGKILL deadline would land in the past on the first poll after a
  // wake and kill a tenant that was shutting down cleanly.
  test('one already asked to stop is refused', () => {
    expect(refusalToSleep({ ...sleepable, stopRequested: true })).toContain('asked to stop');
  });

  test('so is one the control plane no longer wants running', () => {
    expect(refusalToSleep({ ...sleepable, desiredRunning: false })).toContain('asked to stop');
  });

  // Firecracker injects the VMGenID interrupt before vCPUs resume, and a kernel snapshotted
  // before its interrupt handling was in place can crash taking it — fatally, under `panic=1`.
  test('one that has never answered may not have finished booting', () => {
    expect(refusalToSleep({ ...sleepable, everHealthy: false })).toContain('finished booting');
  });

  test('an app this host holds no record of is refused rather than assumed healthy', () => {
    expect(refusalToSleep(undefined)).toBeDefined();
  });
});

describe('what a wake checks before anything is started', () => {
  test('a stamp matching the host as it is now passes', async () => {
    await run(
      Effect.gen(function* () {
        const stampPath = stampedIn(yield* temporaryDirectory);
        yield* writeJsonFile({ path: stampPath, value: stamp });
        yield* ensureLoadable({ stampPath, expected: stamp });
      }),
    );
  });

  test('a host that has rebooted since keeps nothing loadable', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const stampPath = stampedIn(yield* temporaryDirectory);
        yield* writeJsonFile({ path: stampPath, value: stamp });
        return yield* Effect.either(
          ensureLoadable({ stampPath, expected: { ...stamp, hostBootId: 'after-a-reboot' } }),
        );
      }),
    );
    expect(outcome._tag === 'Left' && outcome.left.message).toContain('rebooted');
  });

  test('an app this host kept no snapshot of is refused rather than guessed at', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const stampPath = stampedIn(yield* temporaryDirectory);
        return yield* Effect.either(ensureLoadable({ stampPath, expected: stamp }));
      }),
    );
    expect(outcome._tag === 'Left' && outcome.left._tag).toBe('SnapshotUnusable');
  });
});

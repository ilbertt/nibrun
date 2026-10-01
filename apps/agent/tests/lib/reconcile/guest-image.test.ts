import { describe, expect, test } from 'bun:test';
import { AppIdSchema, DeploymentIdSchema, Value } from '@repo/protocol';
import { planGuestImageRollout } from '#lib/reconcile/guest-image.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { APP_ID, desiredInstance, instanceRecord } from '#tests/support/fixtures.ts';

const OLD_VERSION = 'image-old';
const NEW_VERSION = 'image-new';
const OTHER_APP = Value.Parse(AppIdSchema, 'other-app');
const FIRST_INSTANCE = desiredInstance();
const INSTANCES = [FIRST_INSTANCE, desiredInstance({ appId: OTHER_APP })];

function plan({
  records,
  running = new Set([APP_ID, OTHER_APP]),
  instances = INSTANCES,
}: {
  records: readonly InstanceRecord[];
  running?: ReadonlySet<typeof APP_ID>;
  instances?: typeof INSTANCES;
}) {
  return planGuestImageRollout({
    records: new Map(records.map((record) => [record.appId, record])),
    running,
    instances,
    version: NEW_VERSION,
  });
}

describe('guest image rollout planning', () => {
  test('only one outdated running VM is selected per pass', () => {
    const records = [
      instanceRecord({ guestImageVersion: OLD_VERSION }),
      instanceRecord({ appId: OTHER_APP, guestImageVersion: OLD_VERSION }),
    ];
    expect(plan({ records })).toEqual({ action: 'upgrade', desired: FIRST_INSTANCE });
  });

  test('a legacy VM whose image is unknown is upgraded once', () => {
    expect(plan({ records: [instanceRecord()] })).toEqual({
      action: 'upgrade',
      desired: FIRST_INSTANCE,
    });
    expect(plan({ records: [instanceRecord({ guestImageVersion: NEW_VERSION })] })).toEqual({
      action: 'none',
    });
  });

  test('sleeping apps are left asleep until their next cold boot', () => {
    expect(
      plan({
        records: [
          instanceRecord({ guestImageVersion: OLD_VERSION, state: 'idle', onRequest: true }),
        ],
        running: new Set(),
      }),
    ).toEqual({ action: 'none' });
  });

  test('manual suspension does not wake or restart an app', () => {
    expect(
      plan({
        records: [instanceRecord({ guestImageVersion: OLD_VERSION })],
        instances: [desiredInstance({ desiredState: 'stopped' })],
      }),
    ).toEqual({ action: 'none' });
  });

  test('a pending boot prevents the next VM from upgrading', () => {
    expect(
      plan({
        records: [
          instanceRecord({
            guestImageVersion: NEW_VERSION,
            guestImageUpgradeTarget: NEW_VERSION,
            state: 'starting',
          }),
          instanceRecord({ appId: OTHER_APP, guestImageVersion: OLD_VERSION }),
        ],
      }),
    ).toEqual({ action: 'wait' });
  });

  test('a failed upgrade pauses the rollout', () => {
    expect(
      plan({
        records: [
          instanceRecord({ guestImageUpgradeTarget: NEW_VERSION, state: 'failed' }),
          instanceRecord({ appId: OTHER_APP, guestImageVersion: OLD_VERSION }),
        ],
      }),
    ).toEqual({ action: 'wait' });
  });

  test('an upgraded VM is confirmed only after passing its health checks', () => {
    const upgraded = instanceRecord({
      guestImageVersion: NEW_VERSION,
      guestImageUpgradeTarget: NEW_VERSION,
      health: { consecutiveSuccesses: 1, consecutiveFailures: 0, everHealthy: true },
    });
    expect(plan({ records: [upgraded] })).toEqual({ action: 'confirm', appId: APP_ID });
    expect(
      plan({
        records: [upgraded, instanceRecord({ appId: OTHER_APP, guestImageVersion: OLD_VERSION })],
      }),
    ).toEqual({ action: 'confirm', appId: APP_ID });
  });

  test('normal redeployment retains ownership of a changed deployment', () => {
    expect(
      plan({
        records: [
          instanceRecord({
            deploymentId: Value.Parse(DeploymentIdSchema, 'other-deployment'),
            guestImageVersion: OLD_VERSION,
          }),
        ],
      }),
    ).toEqual({ action: 'none' });
  });

  test('image upgrades retain the app deployment identity and activation policy', () => {
    const wanted = desiredInstance({ desiredState: 'on-request' });
    expect(
      plan({
        records: [instanceRecord({ onRequest: true, guestImageVersion: OLD_VERSION })],
        instances: [wanted],
      }),
    ).toEqual({ action: 'upgrade', desired: wanted });
  });
});

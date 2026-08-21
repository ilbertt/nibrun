import { describe, expect, test } from 'bun:test';
import {
  AppIdSchema,
  DeploymentIdSchema,
  type DeploymentState,
  type InstanceState,
  type ReportedInstance,
  Value,
} from '@repo/protocol';
import { DeploymentLifecycle, STARTUP_DEADLINE_MS } from '#lib/deployments/lifecycle.ts';

const APP_ID = Value.Parse(AppIdSchema, 'app-1');
const DEPLOYMENT_ID = Value.Parse(DeploymentIdSchema, 'deployment-1');
const CREATED_AT = new Date('2026-08-04T10:00:00.000Z');
const JUST_DEPLOYED_MS = 1000;

function reported(state: InstanceState): ReportedInstance {
  return { appId: APP_ID, deploymentId: DEPLOYMENT_ID, state, restartCount: 0 };
}

function advance({
  from = 'pending',
  instance,
  desiredRunning = true,
  afterMs = JUST_DEPLOYED_MS,
  stateChangedAt = CREATED_AT,
}: {
  from?: DeploymentState;
  instance?: InstanceState;
  desiredRunning?: boolean;
  afterMs?: number;
  stateChangedAt?: Date;
}): DeploymentState {
  return new DeploymentLifecycle({
    state: from,
    desiredRunning,
    createdAt: CREATED_AT,
    stateChangedAt,
  }).advanceState({
    reported: instance && reported(instance),
    now: new Date(CREATED_AT.getTime() + afterMs),
  });
}

describe('a release follows the microVM running it', () => {
  const cases: [InstanceState, DeploymentState][] = [
    ['pending', 'starting'],
    ['starting', 'starting'],
    ['running', 'active'],
    ['failed', 'failed'],
  ];

  for (const [instance, expected] of cases) {
    test(`a ${instance} instance makes a pending deployment ${expected}`, () => {
      expect(advance({ instance })).toBe(expected);
    });
  }
});

describe('serving is what a release is for', () => {
  // Health that comes and goes belongs to the app, not to the release: making it a deployment
  // state would churn the index that keeps one live per app every time a probe missed.
  const survivable: InstanceState[] = ['unhealthy', 'stopping', 'stopped', 'starting', 'pending'];

  for (const instance of survivable) {
    test(`an active deployment stays active while its instance is ${instance}`, () => {
      expect(advance({ from: 'active', instance })).toBe('active');
    });
  }

  test('and leaves only when the instance runs out of restarts', () => {
    expect(advance({ from: 'active', instance: 'failed' })).toBe('failed');
  });

  // Desired state still asks for it, so the host either brings it back and says so or gives up
  // and reports `failed`. Reading absence as failure would race every agent restart instead.
  test('an active deployment missing from a report is not a failed one', () => {
    expect(advance({ from: 'active', afterMs: STARTUP_DEADLINE_MS })).toBe('active');
  });
});

describe('a deployment nothing ever starts is one the owner is told about', () => {
  test('before the deadline it is still coming up', () => {
    expect(advance({ afterMs: STARTUP_DEADLINE_MS - 1 })).toBe('pending');
  });

  test('after it, it failed', () => {
    expect(advance({ afterMs: STARTUP_DEADLINE_MS })).toBe('failed');
  });

  // A host is entitled to leave it stopped, so it is not late for anything.
  test("a suspended app's deployment waits indefinitely", () => {
    expect(advance({ desiredRunning: false, afterMs: STARTUP_DEADLINE_MS })).toBe('pending');
  });

  test('one whose instance never accepts a connection fails on the same deadline', () => {
    expect(advance({ from: 'starting', instance: 'unhealthy', afterMs: STARTUP_DEADLINE_MS })).toBe(
      'failed',
    );
  });
});

/**
 * The half an owner watches. Suspending is instant on the app row and not instant on the host, so
 * what the release says is the only thing that can tell a microVM winding down from one that is
 * down — and, on the way back, one booting from one that is serving.
 */
describe('a suspended app stops its release once the host says the microVM is down', () => {
  test('a release stays serving while the microVM is still winding down', () => {
    expect(advance({ from: 'active', instance: 'stopping', desiredRunning: false })).toBe('active');
  });

  test('and stops once the host reports it stopped', () => {
    expect(advance({ from: 'active', instance: 'stopped', desiredRunning: false })).toBe('stopped');
  });

  // The same stop with the app still wanted running is a host that lost the microVM, which is
  // news the release survives — desired state asks for it again on the next pass.
  test('a stop nobody asked for leaves the release serving', () => {
    expect(advance({ from: 'active', instance: 'stopped' })).toBe('active');
  });

  test('a release that never served stops too rather than waiting out a deadline', () => {
    expect(
      advance({
        from: 'starting',
        instance: 'stopped',
        desiredRunning: false,
        afterMs: STARTUP_DEADLINE_MS,
      }),
    ).toBe('stopped');
  });
});

describe('resuming brings the release back up through starting', () => {
  const cases: [InstanceState, DeploymentState][] = [
    ['pending', 'starting'],
    ['starting', 'starting'],
    ['running', 'active'],
    ['failed', 'failed'],
  ];

  for (const [instance, expected] of cases) {
    test(`a ${instance} instance makes a stopped deployment ${expected}`, () => {
      expect(advance({ from: 'stopped', instance })).toBe(expected);
    });
  }

  // Nothing is late while it is stopped, and the host has yet to pick the resume up.
  test('a stopped release waits for the host without failing', () => {
    expect(advance({ from: 'stopped', afterMs: STARTUP_DEADLINE_MS })).toBe('stopped');
  });

  test('and one still reported stopped is one the host has not got to yet', () => {
    expect(advance({ from: 'stopped', instance: 'stopped', afterMs: STARTUP_DEADLINE_MS })).toBe(
      'stopped',
    );
  });
});

/**
 * The deadline is what a release that never came up is failed on, and an app suspended for an
 * hour would come back to one that ran out while nothing was allowed to start it.
 */
describe('the startup deadline runs from the moment the app was asked to run', () => {
  const SUSPENDED_FOR_MS = STARTUP_DEADLINE_MS * 10;

  test('a resume starts the clock again', () => {
    expect(
      advance({
        from: 'starting',
        instance: 'stopped',
        afterMs: SUSPENDED_FOR_MS,
        stateChangedAt: new Date(CREATED_AT.getTime() + SUSPENDED_FOR_MS),
      }),
    ).toBe('starting');
  });

  test('and it runs out again if the host still has nothing to show for it', () => {
    expect(
      advance({
        from: 'starting',
        instance: 'stopped',
        afterMs: SUSPENDED_FOR_MS + STARTUP_DEADLINE_MS,
        stateChangedAt: new Date(CREATED_AT.getTime() + SUSPENDED_FOR_MS),
      }),
    ).toBe('failed');
  });

  // An app nobody has ever suspended changed state when it was created, which is before every
  // deployment it has — so the clock is the deployment's own.
  test('an app whose state has never moved is on its deployment clock', () => {
    expect(
      advance({
        instance: 'stopped',
        afterMs: STARTUP_DEADLINE_MS,
        stateChangedAt: new Date(CREATED_AT.getTime() - SUSPENDED_FOR_MS),
      }),
    ).toBe('failed');
  });
});

describe('a terminal deployment is not something a report can reopen', () => {
  const terminal: DeploymentState[] = ['superseded', 'failed'];

  for (const from of terminal) {
    test(`a ${from} deployment ignores an instance claiming to run`, () => {
      expect(advance({ from, instance: 'running' })).toBe(from);
    });
  }
});

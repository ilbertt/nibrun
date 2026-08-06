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
}: {
  from?: DeploymentState;
  instance?: InstanceState;
  desiredRunning?: boolean;
  afterMs?: number;
}): DeploymentState {
  return new DeploymentLifecycle({
    state: from,
    desiredRunning,
    createdAt: CREATED_AT,
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

describe('a terminal deployment is not something a report can reopen', () => {
  const terminal: DeploymentState[] = ['superseded', 'failed'];

  for (const from of terminal) {
    test(`a ${from} deployment ignores an instance claiming to run`, () => {
      expect(advance({ from, instance: 'running' })).toBe(from);
    });
  }
});

import { describe, expect, test } from 'bun:test';
import type {
  DeploymentId,
  DeploymentState,
  InstanceId,
  InstanceState,
  ReportedInstance,
} from '@repo/protocol';
import {
  type DeploymentObservation,
  nextDeploymentState,
  STARTUP_DEADLINE_MS,
} from '#lib/deployment-transition.ts';

const INSTANCE_ID = 'instance-1' as InstanceId;
const DEPLOYMENT_ID = 'deployment-1' as DeploymentId;
const JUST_DEPLOYED_MS = 1000;

function reported(state: InstanceState): ReportedInstance {
  return { instanceId: INSTANCE_ID, deploymentId: DEPLOYMENT_ID, state, restartCount: 0 };
}

function observation(overrides: Partial<DeploymentObservation> = {}): DeploymentObservation {
  return {
    current: 'pending',
    reported: undefined,
    desiredRunning: true,
    ageMs: JUST_DEPLOYED_MS,
    ...overrides,
  };
}

describe('a release follows the microVM running it', () => {
  const cases: [InstanceState, DeploymentState | null][] = [
    ['pending', 'starting'],
    ['starting', 'starting'],
    ['running', 'active'],
    ['failed', 'failed'],
  ];

  for (const [instance, expected] of cases) {
    test(`a ${instance} instance makes a pending deployment ${expected}`, () => {
      expect(nextDeploymentState(observation({ reported: reported(instance) }))).toBe(expected);
    });
  }

  // Nothing to write is the common case — a host reports every heartbeat, and almost none of
  // them are news.
  test('a state it is already in is no transition at all', () => {
    expect(
      nextDeploymentState(observation({ current: 'starting', reported: reported('starting') })),
    ).toBeNull();
  });
});

describe('serving is what a release is for', () => {
  // Health that comes and goes belongs to the app, not to the release: making it a deployment
  // state would churn the index that keeps one live per app every time a probe missed.
  const survivable: InstanceState[] = ['unhealthy', 'stopping', 'stopped', 'starting', 'pending'];

  for (const instance of survivable) {
    test(`an active deployment stays active while its instance is ${instance}`, () => {
      expect(
        nextDeploymentState(observation({ current: 'active', reported: reported(instance) })),
      ).toBeNull();
    });
  }

  test('and leaves only when the instance runs out of restarts', () => {
    expect(
      nextDeploymentState(observation({ current: 'active', reported: reported('failed') })),
    ).toBe('failed');
  });

  // Desired state still asks for it, so the host either brings it back and says so or gives up
  // and reports `failed`. Reading absence as failure would race every agent restart instead.
  test('an active deployment missing from a report is not a failed one', () => {
    expect(
      nextDeploymentState(observation({ current: 'active', ageMs: STARTUP_DEADLINE_MS })),
    ).toBe(null);
  });
});

describe('a deployment nothing ever starts is one the owner is told about', () => {
  test('before the deadline it is still starting up', () => {
    expect(nextDeploymentState(observation({ ageMs: STARTUP_DEADLINE_MS - 1 }))).toBeNull();
  });

  test('after it, it failed', () => {
    expect(nextDeploymentState(observation({ ageMs: STARTUP_DEADLINE_MS }))).toBe('failed');
  });

  // A host is entitled to leave it stopped, so it is not late for anything.
  test("a suspended app's deployment waits indefinitely", () => {
    expect(
      nextDeploymentState(observation({ desiredRunning: false, ageMs: STARTUP_DEADLINE_MS })),
    ).toBeNull();
  });

  test('one whose instance never accepts a connection fails on the same deadline', () => {
    expect(
      nextDeploymentState(
        observation({
          current: 'starting',
          reported: reported('unhealthy'),
          ageMs: STARTUP_DEADLINE_MS,
        }),
      ),
    ).toBe('failed');
  });
});

describe('a terminal deployment is not something a report can reopen', () => {
  const terminal: DeploymentState[] = ['superseded', 'failed'];

  for (const current of terminal) {
    test(`a ${current} deployment ignores an instance claiming to run`, () => {
      expect(
        nextDeploymentState(observation({ current, reported: reported('running') })),
      ).toBeNull();
    });
  }
});

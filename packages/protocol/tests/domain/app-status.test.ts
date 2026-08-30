import { describe, expect, test } from 'bun:test';
import type { AppState, DeploymentState } from '@repo/protocol';
import { type AppStatus, appStatus, hasLiveOutput, isSettling } from '#domain/app-status.ts';

function status({
  appState = 'active',
  deploymentState,
}: {
  appState?: AppState;
  deploymentState?: DeploymentState;
} = {}): AppStatus {
  return appStatus({ appState, deploymentState });
}

describe('an app on its way out answers for itself', () => {
  const going = ['deleting', 'deleted'] as const satisfies readonly AppState[];

  for (const appState of going) {
    test(`a ${appState} app says so whatever its release says`, () => {
      expect(status({ appState, deploymentState: 'running' })).toEqual({
        kind: 'app',
        state: appState,
      });
    });
  }
});

/**
 * The gap this exists for. Pressing suspend moves the app row and nothing else: the microVM is
 * still serving until a host says otherwise, and saying "suspended" before then is the page
 * claiming something that has not happened.
 */
describe('suspending is not suspended until the release stops', () => {
  const serving: DeploymentState[] = ['running', 'starting', 'pending'];

  for (const deploymentState of serving) {
    test(`a ${deploymentState} release under a suspended app is still winding down`, () => {
      expect(status({ appState: 'suspended', deploymentState })).toEqual({
        kind: 'transition',
        label: 'suspending',
      });
    });
  }

  const down: DeploymentState[] = ['stopped', 'failed', 'superseded'];

  for (const deploymentState of down) {
    test(`a ${deploymentState} release under a suspended app is down`, () => {
      expect(status({ appState: 'suspended', deploymentState })).toEqual({
        kind: 'app',
        state: 'suspended',
      });
    });
  }

  test('and an app nobody ever deployed has nothing to wind down', () => {
    expect(status({ appState: 'suspended' })).toEqual({ kind: 'app', state: 'suspended' });
  });
});

describe('resuming is not running until the host has started it', () => {
  test('an active app whose release is stopped is still coming back', () => {
    expect(status({ deploymentState: 'stopped' })).toEqual({
      kind: 'transition',
      label: 'resuming',
    });
  });

  const followed = [
    'pending',
    'starting',
    'running',
    'failed',
    'superseded',
  ] as const satisfies readonly DeploymentState[];

  for (const deploymentState of followed) {
    test(`and a ${deploymentState} release is what the app is doing`, () => {
      expect(status({ deploymentState })).toEqual({ kind: 'deployment', state: deploymentState });
    });
  }

  test('an app with no release at all has never been deployed', () => {
    expect(status()).toEqual({ kind: 'never-deployed' });
  });
});

describe('what is worth asking about again', () => {
  const moving: [string, AppStatus][] = [
    ['suspending', { kind: 'transition', label: 'suspending' }],
    ['resuming', { kind: 'transition', label: 'resuming' }],
    ['a pending release', { kind: 'deployment', state: 'pending' }],
    ['a starting release', { kind: 'deployment', state: 'starting' }],
  ];

  for (const [name, status] of moving) {
    test(`${name} is still moving`, () => {
      expect(isSettling(status)).toBe(true);
    });
  }

  // A suspended app is the one that looks transitional and is not: the host has done what it was
  // asked, and asking again every two seconds forever is what this stops.
  const settled: [string, AppStatus][] = [
    ['a serving release', { kind: 'deployment', state: 'running' }],
    ['a failed release', { kind: 'deployment', state: 'failed' }],
    ['a suspended app', { kind: 'app', state: 'suspended' }],
    ['an app never deployed', { kind: 'never-deployed' }],
  ];

  for (const [name, status] of settled) {
    test(`${name} is not`, () => {
      expect(isSettling(status)).toBe(false);
    });
  }
});

describe('what has something running to write output', () => {
  const writing: [string, AppStatus][] = [
    ['a serving release', status({ deploymentState: 'running' })],
    ['a booting one', status({ deploymentState: 'starting' })],
    ['an app still winding down', status({ appState: 'suspended', deploymentState: 'running' })],
    ['one on its way back', status({ deploymentState: 'stopped' })],
  ];

  for (const [name, each] of writing) {
    test(`${name} has`, () => {
      expect(hasLiveOutput(each)).toBe(true);
    });
  }

  // A release being staged is the one that looks like it is coming up and has nothing up yet: no
  // host has made a microVM for it, so there is nothing tailing it can carry.
  const silent: [string, AppStatus][] = [
    ['a release still being staged', status({ deploymentState: 'pending' })],
    ['a failed one', status({ deploymentState: 'failed' })],
    ['a superseded one', status({ deploymentState: 'superseded' })],
    ['a suspended app', status({ appState: 'suspended', deploymentState: 'stopped' })],
    ['one nobody has deployed', status()],
    ['one being deleted', status({ appState: 'deleting' })],
  ];

  for (const [name, each] of silent) {
    test(`${name} has not`, () => {
      expect(hasLiveOutput(each)).toBe(false);
    });
  }
});

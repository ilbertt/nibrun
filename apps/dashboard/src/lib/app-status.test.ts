import { describe, expect, test } from 'bun:test';
import type { AppState, DeploymentState } from '@repo/protocol';
import { type AppStatus, appStatus, isSettling } from '#lib/app-status.ts';

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
      expect(status({ appState, deploymentState: 'active' })).toEqual({
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
  const serving: DeploymentState[] = ['active', 'starting', 'pending'];

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
    'active',
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
    ['a serving release', { kind: 'deployment', state: 'active' }],
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

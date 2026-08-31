import { describe, expect, test } from 'bun:test';
import type { AppState, DeploymentState, InstanceState } from '@repo/protocol';
import {
  APP_STATUS_LABELS,
  type AppStatus,
  appStatus,
  hasLiveOutput,
  isSettling,
  statusKey,
} from '#status.ts';

function status({
  appState = 'active',
  deploymentState,
  instanceState,
}: {
  appState?: AppState;
  deploymentState?: DeploymentState;
  instanceState?: InstanceState;
} = {}): AppStatus {
  return appStatus({ appState, deploymentState, instanceState });
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

/**
 * An `on-request` app is the one case where the release and the microVM say different things: the
 * release is running because the next visitor reaches it, and there is nothing running until one
 * does. The owner is owed the second half — a page saying `running` about an app holding no memory
 * and reporting no readings is a page they would read as broken.
 */
describe('an app idle between requests says so', () => {
  test('a running release with no microVM behind it is idle', () => {
    expect(status({ deploymentState: 'running', instanceState: 'idle' })).toEqual({
      kind: 'instance',
      state: 'idle',
    });
  });

  test('and it is not an error: waiting to be asked is what it was configured for', () => {
    expect(
      APP_STATUS_LABELS[statusKey(status({ deploymentState: 'running', instanceState: 'idle' }))],
    ).toBe('idle');
  });

  // Read only under a release that is serving. Anything else is a host still catching up with a
  // deploy or a suspend, and the release is the one being waited on there.
  const elsewhere = [
    'pending',
    'starting',
    'stopped',
  ] as const satisfies readonly DeploymentState[];

  for (const deploymentState of elsewhere) {
    test(`a ${deploymentState} release is what the app is doing whatever its microVM says`, () => {
      expect(status({ deploymentState, instanceState: 'idle' })).not.toEqual({
        kind: 'instance',
        state: 'idle',
      });
    });
  }

  test('a suspended app is suspending whatever its microVM says', () => {
    expect(
      status({ appState: 'suspended', deploymentState: 'running', instanceState: 'idle' }),
    ).toEqual({
      kind: 'transition',
      label: 'suspending',
    });
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
    // Nothing is going to move it: only a visitor can, and no amount of asking is one.
    ['an app idle between requests', { kind: 'instance', state: 'idle' }],
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
    ['one idle between requests', status({ deploymentState: 'running', instanceState: 'idle' })],
  ];

  for (const [name, each] of silent) {
    test(`${name} has not`, () => {
      expect(hasLiveOutput(each)).toBe(false);
    });
  }
});

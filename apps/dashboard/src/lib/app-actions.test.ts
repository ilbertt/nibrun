import { describe, expect, test } from 'bun:test';
import { APP_STATES, type AppState, DEPLOYMENT_STATES, type DeploymentState } from '@repo/protocol';
import { APP_ACTIONS, type AppActions, appActions } from '#lib/app-actions.ts';
import { appStatus } from '#lib/app-status.ts';

function actions({
  appState = 'active',
  deploymentState,
}: {
  appState?: AppState;
  deploymentState?: DeploymentState;
} = {}): AppActions {
  return appActions(appStatus({ appState, deploymentState }));
}

describe('an app is offered what its state can actually do', () => {
  test('one nobody has deployed has nothing to export and nothing to take offline', () => {
    expect(actions()).toEqual({
      deploy: 'enabled',
      export: 'hidden',
      suspend: 'hidden',
      delete: 'enabled',
    });
  });

  const down: DeploymentState[] = ['failed', 'superseded'];

  for (const deploymentState of down) {
    test(`one whose release is ${deploymentState} is exportable and has nothing to suspend`, () => {
      expect(actions({ deploymentState })).toEqual({
        deploy: 'enabled',
        export: 'enabled',
        suspend: 'hidden',
        delete: 'enabled',
      });
    });
  }

  test('a serving one is offered every button', () => {
    expect(actions({ deploymentState: 'active' })).toEqual({
      deploy: 'enabled',
      export: 'enabled',
      suspend: 'enabled',
      delete: 'enabled',
    });
  });

  test('a suspended one is offered the same, the suspend button being the way back', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'stopped' }).suspend).toBe('enabled');
  });
});

/**
 * The two the owner has already asked for. A button that comes back on its own is greyed rather
 * than gone, because taking it away would say the app cannot be asked this at all.
 */
describe('an app the host has not caught up with yet', () => {
  test('is not asked to suspend while it is suspending', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'active' }).suspend).toBe('disabled');
  });

  test('nor while it is coming back', () => {
    expect(actions({ deploymentState: 'stopped' }).suspend).toBe('disabled');
  });

  test('and one not read yet offers nothing to press', () => {
    expect(appActions(undefined)).toEqual({
      deploy: 'disabled',
      export: 'disabled',
      suspend: 'disabled',
      delete: 'disabled',
    });
  });
});

describe('an app on its way out', () => {
  test('has one button left, and it is the one saying so', () => {
    expect(actions({ appState: 'deleting' })).toEqual({
      deploy: 'hidden',
      export: 'hidden',
      suspend: 'hidden',
      delete: 'disabled',
    });
  });

  test('and once it is gone, none at all', () => {
    expect(actions({ appState: 'deleted' })).toEqual({
      deploy: 'hidden',
      export: 'hidden',
      suspend: 'hidden',
      delete: 'hidden',
    });
  });
});

// What the table is for: a state nothing was decided about is a hole here rather than a button
// someone finds behaving oddly in front of a customer.
test('every app and release the api can report is answered for, button by button', () => {
  const releases: (DeploymentState | undefined)[] = [...DEPLOYMENT_STATES, undefined];

  for (const appState of APP_STATES) {
    for (const deploymentState of releases) {
      for (const action of APP_ACTIONS) {
        expect(actions({ appState, deploymentState })[action]).toBeDefined();
      }
    }
  }
});

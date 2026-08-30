import { describe, expect, test } from 'bun:test';
import { appStatus } from '@repo/app-operations';
import { APP_STATES, type AppState, DEPLOYMENT_STATES, type DeploymentState } from '@repo/protocol';
import { APP_ACTIONS, type AppActions, appActions } from '#lib/app-actions.ts';

const ENABLED = { kind: 'enabled' } as const;
const DISABLED = { kind: 'disabled' } as const;
const HIDDEN = { kind: 'hidden' } as const;

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
      deploy: ENABLED,
      redeploy: HIDDEN,
      export: HIDDEN,
      suspend: HIDDEN,
      delete: ENABLED,
    });
  });

  const down: DeploymentState[] = ['failed', 'superseded'];

  for (const deploymentState of down) {
    test(`one whose release is ${deploymentState} is exportable and has nothing to suspend`, () => {
      expect(actions({ deploymentState })).toEqual({
        deploy: ENABLED,
        redeploy: deploymentState === 'failed' ? ENABLED : HIDDEN,
        export: ENABLED,
        suspend: HIDDEN,
        delete: ENABLED,
      });
    });
  }

  test('a serving one is offered everything there is to do to a running app', () => {
    expect(actions({ deploymentState: 'running' })).toEqual({
      deploy: ENABLED,
      redeploy: HIDDEN,
      export: ENABLED,
      suspend: ENABLED,
      delete: ENABLED,
    });
  });

  test('a suspended one is offered the same, the suspend button being the way back', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'stopped' }).suspend).toEqual(ENABLED);
  });
});

/**
 * The two the owner has already asked for. A button that comes back on its own is greyed rather
 * than gone, because taking it away would say the app cannot be asked this at all.
 */
describe('an app the host has not caught up with yet', () => {
  test('is not asked to suspend while it is suspending', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'running' }).suspend).toEqual(
      DISABLED,
    );
  });

  test('nor while it is coming back', () => {
    expect(actions({ deploymentState: 'stopped' }).suspend).toEqual(DISABLED);
  });

  test('and one on its way down offers nothing to press at all', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'running' })).toEqual({
      deploy: { kind: 'disabled', reason: expect.any(String) },
      redeploy: HIDDEN,
      export: DISABLED,
      suspend: DISABLED,
      delete: DISABLED,
    });
  });

  test('and one not read yet offers nothing to press', () => {
    expect(appActions(undefined)).toEqual({
      deploy: DISABLED,
      redeploy: HIDDEN,
      export: DISABLED,
      suspend: DISABLED,
      delete: DISABLED,
    });
  });
});

/**
 * A release is only started for an app whose row asks to run, so one deployed here would sit
 * pending until the app is resumed. The button is greyed with the sentence saying so, because
 * unlike the two above it has no label of its own to say what it is waiting on.
 */
describe('a suspended app', () => {
  for (const deploymentState of [...DEPLOYMENT_STATES, undefined]) {
    test(`is not offered a deploy, and says why, with a ${deploymentState ?? 'missing'} release`, () => {
      expect(actions({ appState: 'suspended', deploymentState }).deploy).toEqual({
        kind: 'disabled',
        reason: expect.any(String),
      });
    });
  }

  test('is offered one again the moment it is asked to run, before the host has started it', () => {
    expect(actions({ deploymentState: 'stopped' }).deploy).toEqual(ENABLED);
  });
});

/**
 * A button for one status, because it is an answer to one: a release that did not come up is the
 * case where running the same binary again is the whole of what an owner wants. Everywhere else
 * releasing again is the deploy dialog, which can change what it releases as well.
 */
describe('a release that did not come up', () => {
  test('is the one an app is offered a redeploy on', () => {
    expect(actions({ deploymentState: 'failed' }).redeploy).toEqual(ENABLED);
  });

  for (const deploymentState of DEPLOYMENT_STATES.filter((state) => state !== 'failed')) {
    test(`and a ${deploymentState} one is not`, () => {
      expect(actions({ deploymentState }).redeploy).toEqual(HIDDEN);
    });
  }

  test('nor is an app nobody has ever deployed', () => {
    expect(actions().redeploy).toEqual(HIDDEN);
  });

  test('nor a suspended one, which would not start what it released', () => {
    expect(actions({ appState: 'suspended', deploymentState: 'failed' }).redeploy).toEqual(HIDDEN);
  });
});

describe('an app on its way out', () => {
  test('has one button left, and it is the one saying so', () => {
    expect(actions({ appState: 'deleting' })).toEqual({
      deploy: HIDDEN,
      redeploy: HIDDEN,
      export: HIDDEN,
      suspend: HIDDEN,
      delete: DISABLED,
    });
  });

  test('and once it is gone, none at all', () => {
    expect(actions({ appState: 'deleted' })).toEqual({
      deploy: HIDDEN,
      redeploy: HIDDEN,
      export: HIDDEN,
      suspend: HIDDEN,
      delete: HIDDEN,
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

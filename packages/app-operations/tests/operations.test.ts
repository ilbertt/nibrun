import { describe, expect, test } from 'bun:test';
import { APP_STATES, type AppState, DEPLOYMENT_STATES, type DeploymentState } from '@repo/protocol';
import { APP_OPERATIONS, type AppOperation, operationRefusal } from '#operations.ts';
import { appStatus } from '#status.ts';

const SLUG = 'quiet-otter';

function refusal({
  operation,
  appState = 'active',
  deploymentState,
  message,
}: {
  operation: AppOperation;
  appState?: AppState;
  deploymentState?: DeploymentState;
  message?: string;
}): string | undefined {
  return operationRefusal({
    status: appStatus({ appState, deploymentState }),
    operation,
    slug: SLUG,
    release: deploymentState && { id: 'deployment-1', state: deploymentState, message },
  });
}

describe('an app nobody has deployed', () => {
  const nothingToRead: AppOperation[] = ['logs', 'files', 'export'];

  for (const operation of nothingToRead) {
    test(`has nothing for ${operation} to read`, () => {
      expect(refusal({ operation })).toContain('App quiet-otter has never been deployed');
    });
  }

  test('and is what a first release is made onto', () => {
    expect(refusal({ operation: 'release' })).toBeUndefined();
  });
});

describe('a release that is not serving', () => {
  test('is not a filesystem to read', () => {
    expect(refusal({ operation: 'files', deploymentState: 'failed' })).toBe(
      'App quiet-otter is on a release that failed, so nothing is mounting its filesystem to read.',
    );
  });

  // The state says the release did not come up; only the release says what the host saw when it
  // didn't, and that is the half worth reading.
  test('and says what the host said about it, where it said anything', () => {
    expect(
      refusal({ operation: 'files', deploymentState: 'failed', message: 'exec format error' }),
    ).toEndWith('exec format error');
  });

  test('but is still a volume to bundle', () => {
    expect(refusal({ operation: 'export', deploymentState: 'failed' })).toBeUndefined();
  });

  test('and still an output to read', () => {
    expect(refusal({ operation: 'logs', deploymentState: 'failed' })).toBeUndefined();
  });
});

describe('a suspended app', () => {
  test('takes no release, and says how to make it take one', () => {
    expect(
      refusal({ operation: 'release', appState: 'suspended', deploymentState: 'stopped' }),
    ).toBe('App quiet-otter is suspended, so a new release would never start. Resume it first.');
  });

  test('has nothing mounting its filesystem', () => {
    expect(
      refusal({ operation: 'files', appState: 'suspended', deploymentState: 'stopped' }),
    ).toContain('is suspended');
  });

  // A microVM still winding down is one that is about to be gone, and a browse offered for the
  // seconds it has left is worse than saying the app is suspended a moment early.
  test('and one still winding down answers the same way', () => {
    expect(
      refusal({ operation: 'files', appState: 'suspended', deploymentState: 'active' }),
    ).toContain('is suspending');
  });

  test('but is still a volume to bundle', () => {
    expect(
      refusal({ operation: 'export', appState: 'suspended', deploymentState: 'stopped' }),
    ).toBeUndefined();
  });
});

describe('an app on its way out', () => {
  const gone: AppOperation[] = ['release', 'files', 'export', 'suspend', 'resume', 'domains'];

  for (const operation of gone) {
    test(`has nothing left for ${operation}`, () => {
      expect(refusal({ operation, appState: 'deleting' })).toContain('is being deleted');
    });
  }

  // Reading what an app wrote asks nothing of the host tearing it down, and up to the moment it
  // goes it is the only account of what it did.
  test('and its output is readable right up to the moment it goes', () => {
    expect(refusal({ operation: 'logs', appState: 'deleting' })).toBeUndefined();
  });
});

test('a serving app refuses nothing', () => {
  for (const operation of APP_OPERATIONS) {
    expect(refusal({ operation, deploymentState: 'active' })).toBeUndefined();
  }
});

// What the table is for: a state nothing was decided about is a row missing from it rather than a
// command someone finds hanging on an app that was never going to answer.
test('every app and release the api can report is answered for, command by command', () => {
  const releases: (DeploymentState | undefined)[] = [...DEPLOYMENT_STATES, undefined];

  for (const appState of APP_STATES) {
    for (const deploymentState of releases) {
      for (const operation of APP_OPERATIONS) {
        expect(() => refusal({ operation, appState, deploymentState })).not.toThrow();
      }
    }
  }
});

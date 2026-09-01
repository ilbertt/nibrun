import { describe, expect, test } from 'bun:test';
import type { AppActivation, AppState, DeploymentState } from '@repo/protocol';
import type { Queries } from '#db/queries.gen.ts';
import { environmentByDeployment, toDesiredInstance } from '#lib/deployments/desired-state.ts';
import { sealEnvironment, sealedFromStore } from '#lib/tenant-secrets.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

type EnvironmentRow = Queries['SelectDesiredEnvironment'];

const DEPLOYMENT = 'deployment-1';
const OTHER_DEPLOYMENT = 'deployment-2';
const SECRET = '/app/data/.openclaw';
const IDLE_TIMEOUT_MS = 900_000;

function rowsFor(entries: Array<[string, string, string]>): EnvironmentRow[] {
  return entries.map(
    ([deployment, name, value]) =>
      ({ deployment_id: deployment, name, value }) as unknown as EnvironmentRow,
  );
}

describe('a relation of many rows becomes one environment per instance', () => {
  test('every variable of a deployment lands under it', () => {
    const grouped = environmentByDeployment(
      rowsFor([
        [DEPLOYMENT, 'A', 'one'],
        [DEPLOYMENT, 'B', 'two'],
      ]),
    );

    expect(grouped.get(DEPLOYMENT)).toEqual({
      A: sealedFromStore('one'),
      B: sealedFromStore('two'),
    });
  });

  // Two deployments can pin the same config version, so the grouping key has to be the deployment
  // and not the config it came from.
  test('two deployments do not share one environment', () => {
    const grouped = environmentByDeployment(
      rowsFor([
        [DEPLOYMENT, 'A', 'mine'],
        [OTHER_DEPLOYMENT, 'A', 'theirs'],
      ]),
    );

    expect(grouped.get(DEPLOYMENT)).toEqual({ A: sealedFromStore('mine') });
    expect(grouped.get(OTHER_DEPLOYMENT)).toEqual({ A: sealedFromStore('theirs') });
  });

  test('a deployment with no variables is absent rather than empty', () => {
    expect(environmentByDeployment([]).get(DEPLOYMENT)).toBeUndefined();
  });
});

describe('what a host is told to run with', () => {
  test('the sealed values are opened on their way out', () => {
    const instance = toDesiredInstance({
      row: deploymentRow(),
      hostnames: new Map(),
      environments: new Map([
        [
          DEPLOYMENT,
          sealEnvironment({
            key: TEST_SECRETS_KEY,
            environment: { OPENCLAW_STATE_DIR: SECRET } as never,
          }),
        ],
      ]),
      secretsKey: TEST_SECRETS_KEY,
    });

    expect(instance.config.environment).toEqual({ OPENCLAW_STATE_DIR: SECRET } as never);
  });

  test('an instance nothing was stored for runs with none', () => {
    const instance = toDesiredInstance({
      row: deploymentRow(),
      hostnames: new Map(),
      environments: new Map(),
      secretsKey: TEST_SECRETS_KEY,
    });

    expect(instance.config.environment).toEqual({});
  });
});

/**
 * The app's own state, carried on the deployment row: a host is told about every app it holds
 * data for, and what it should be doing with each is read off here rather than from the app
 * dropping out of the list. Suspending is that and nothing more — one row, and the next poll.
 */
describe('whether a host runs it is the state of the app, not of the release', () => {
  test('an active app is the one that runs', () => {
    expect(desiredInstance({ state: 'active' }).desiredState).toBe('running');
  });

  // `deleting` is here because the app stays in desired state until its filesystem is gone, and
  // a microVM still serving out of one being torn down is the thing that must not happen.
  test.each(['suspended', 'deleting'] as const)('a %s app is one the host stops', (state) => {
    expect(desiredInstance({ state }).desiredState).toBe('stopped');
  });
});

/**
 * Two columns, one answer. A host is told what should be true of the app rather than the policy
 * behind it, which is why suspending an `on-request` app produces the same `stopped` as
 * suspending any other: whichever is stricter is what the host has to act on.
 */
describe('how the app comes up is folded into the same answer', () => {
  test('an active app that runs on request is neither running nor stopped', () => {
    expect(desiredInstance({ state: 'active', activation: 'on-request' }).desiredState).toBe(
      'on-request',
    );
  });

  test('suspending it wins over its activation policy', () => {
    expect(desiredInstance({ state: 'suspended', activation: 'on-request' }).desiredState).toBe(
      'stopped',
    );
  });

  /**
   * A release that did not come up is stopped the way a suspended app is, and for a different
   * reason: it stays in the list so the host goes on answering for the hostnames, and `on-request`
   * would have every visitor pay for a boot the last one already proved would not work.
   */
  test('a failed release is stopped whatever the app says it wants', () => {
    expect(
      desiredInstance({ state: 'active', activation: 'on-request', deploymentState: 'failed' })
        .desiredState,
    ).toBe('stopped');
    expect(
      desiredInstance({ state: 'active', activation: 'always', deploymentState: 'failed' })
        .desiredState,
    ).toBe('stopped');
  });

  test('the timeout rides along only where there is something to time', () => {
    expect(desiredInstance({ state: 'active', activation: 'on-request' }).idleTimeoutMs).toBe(
      IDLE_TIMEOUT_MS,
    );
    expect(
      desiredInstance({ state: 'active', activation: 'always' }).idleTimeoutMs,
    ).toBeUndefined();
    expect(
      desiredInstance({ state: 'suspended', activation: 'on-request' }).idleTimeoutMs,
    ).toBeUndefined();
  });
});

function desiredInstance({
  state,
  activation = 'always',
  deploymentState = 'running',
}: {
  state: AppState;
  activation?: AppActivation;
  deploymentState?: DeploymentState;
}) {
  return toDesiredInstance({
    row: { ...deploymentRow(), state, activation, deployment_state: deploymentState },
    hostnames: new Map(),
    environments: new Map(),
    secretsKey: TEST_SECRETS_KEY,
  });
}

function deploymentRow() {
  return {
    id: DEPLOYMENT,
    app_id: 'app-1',
    state: 'active',
    digest: 'sha256:abcd',
    size_bytes: 1n,
    object_key: 'artifacts/app-1/a',
    original_file_name: 'my-server',
    http_port: 8080,
    args: [],
    vcpu_count: 1,
    memory_mib: 512,
    health_check_path: null,
    health_check_interval_ms: 1000,
    health_check_timeout_ms: 1000,
    health_check_grace_period_ms: 0,
    health_check_healthy_threshold: 1,
    health_check_unhealthy_threshold: 1,
    restart_max_restarts: 3,
    restart_initial_backoff_ms: 200,
    restart_max_backoff_ms: 800,
    restart_backoff_factor: 2,
    restart_reset_after_ms: 1000,
    config_id: 'config-1',
    activation: 'always',
    idle_timeout_ms: IDLE_TIMEOUT_MS,
    deployment_state: 'running',
  } as unknown as Parameters<typeof toDesiredInstance>[0]['row'];
}

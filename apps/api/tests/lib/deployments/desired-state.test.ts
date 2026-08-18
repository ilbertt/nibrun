import { describe, expect, test } from 'bun:test';
import type { Queries } from '#db/queries.gen.d.ts';
import { environmentByDeployment, toDesiredInstance } from '#lib/deployments/desired-state.ts';
import { sealEnvironment, sealedFromStore } from '#lib/tenant-secrets.ts';
import { TEST_SECRETS_KEY } from '#tests/support/secrets.ts';

type EnvironmentRow = Queries['SelectDesiredEnvironment'];

const DEPLOYMENT = 'deployment-1';
const OTHER_DEPLOYMENT = 'deployment-2';
const SECRET = '/app/data/.openclaw';

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

function deploymentRow() {
  return {
    id: DEPLOYMENT,
    app_id: 'app-1',
    state: 'active',
    digest: 'sha256:abcd',
    size_bytes: 1n,
    object_key: 'artifacts/app-1/a',
    original_file_name: 'my-server',
    guest_port: 8080,
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
  } as unknown as Parameters<typeof toDesiredInstance>[0]['row'];
}

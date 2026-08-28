import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  type DeploymentId,
  type DeploymentState,
  HostPortSchema,
  type HostReportedState,
  HttpPortSchema,
  type InstanceState,
  Ipv4AddressSchema,
  type ReportedInstance,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { schema } from '#db/queries.gen.ts';
import { type PublicAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';
import { STARTUP_DEADLINE_MS } from '#lib/deployments/lifecycle.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  CreateDeploymentInput,
  DeploymentByIdInput,
  DeploymentRow,
  DeploymentsByAppInput,
  DeploymentsRepositoryContract,
  LiveDeploymentRow,
  ReportedDeployment,
  RollbackDeploymentInput,
} from '#repositories/deployments.repository.ts';
import { DeploymentsService } from '#services/deployments.service.ts';
import {
  APP_ID,
  ARTIFACT_ID,
  configColumns,
  DEFAULT_CONFIG,
  DEPLOYMENT_ID,
  OWNER_ID,
} from '#tests/services/support/fixtures.ts';
import { uniqueViolation } from '#tests/support/postgres.ts';

const HTTP_PORT_NUMBER = 8090;
const HOST_PORT_NUMBER = 30_001;

const HTTP_PORT = Value.Parse(HttpPortSchema, HTTP_PORT_NUMBER);
const OWNER_SCOPED_METHODS = 4;
const CREATED_AT = new Date('2026-08-04T10:00:00.000Z');
const ACTIVATED_AT = new Date('2026-08-04T11:30:00.000Z');
const STARTED_AT = new Date('2026-08-04T11:29:00.000Z');
const LAST_HEALTHY_AT = new Date('2026-08-04T12:00:00.000Z');
const FAILURE_MESSAGE = 'No host started this deployment in time.';
const HEALTHY_AT = new Date('2026-08-04T11:31:00.000Z');
const REPORTED_AT = new Date('2026-08-04T11:32:00.000Z');
const HOST_PORT = Value.Parse(HostPortSchema, HOST_PORT_NUMBER);
const GUEST_IPV4 = Value.Parse(Ipv4AddressSchema, '10.0.0.2');
const RESTART_COUNT = 2;

// The config version this deployment pins. `app_configs` never changes a row, so this is what
// the deployment was launched with however the app has since been reconfigured.
const PINNED_CONFIG: PublicAppConfig = {
  ...DEFAULT_CONFIG,
  httpPort: HTTP_PORT,
  args: ['serve'],
};

// Going back to `DEPLOYMENT_ID`, which is the same route and the same verb as deploying an
// artifact — only the body says which of the two it is.
const ROLLBACK_REQUEST = {
  appId: APP_ID,
  ownerId: OWNER_ID,
  source: { rollbackOf: DEPLOYMENT_ID },
};

const OWNED_DEPLOYMENT: DeploymentByIdInput = {
  appId: APP_ID,
  deploymentId: DEPLOYMENT_ID,
  ownerId: OWNER_ID,
};

function deploymentRow(overrides: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    id: DEPLOYMENT_ID,
    app_id: APP_ID,
    artifact_id: ARTIFACT_ID,
    state: 'pending',
    activated_at: null,
    rollback_of_deployment_id: null,
    created_at: CREATED_AT,
    message: null,
    started_at: null,
    last_healthy_at: null,
    restart_count: 0,
    ...configColumns(PINNED_CONFIG),
    ...overrides,
  };
}

type FakeBehaviour = {
  rows?: DeploymentRow[];
  row?: DeploymentRow | null;
  live?: LiveDeploymentRow[];
  runError?: unknown;
};

class FakeDeploymentsRepository implements DeploymentsRepositoryContract {
  readonly calls: Array<Record<string, unknown>> = [];
  readonly applied: ReportedDeployment[] = [];
  readonly activations: { deploymentId: DeploymentId; at: Date }[] = [];
  readonly failed: DeploymentId[] = [];
  readonly #behaviour: FakeBehaviour;

  constructor(behaviour: FakeBehaviour = {}) {
    this.#behaviour = behaviour;
  }

  listLive(): Promise<LiveDeploymentRow[]> {
    return Promise.resolve(this.#behaviour.live ?? []);
  }

  applyReport({ reported }: { reported: ReportedDeployment[] }): Promise<void> {
    this.applied.push(...reported);
    return Promise.resolve();
  }

  stampActivation(input: { deploymentId: DeploymentId; at: Date }): Promise<void> {
    this.activations.push(input);
    return Promise.resolve();
  }

  fail({ deploymentId }: { deploymentId: DeploymentId }): Promise<void> {
    this.failed.push(deploymentId);
    return Promise.resolve();
  }

  insert(input: CreateDeploymentInput): Promise<DeploymentRow | null> {
    this.calls.push(input);
    if (this.#behaviour.runError) {
      return Promise.reject(this.#behaviour.runError);
    }
    return Promise.resolve(this.#behaviour.row ?? null);
  }

  listByApp(input: DeploymentsByAppInput): Promise<DeploymentRow[]> {
    this.calls.push(input);
    return Promise.resolve(this.#behaviour.rows ?? []);
  }

  findById(input: DeploymentByIdInput): Promise<DeploymentRow | null> {
    this.calls.push(input);
    return Promise.resolve(this.#behaviour.row ?? null);
  }

  insertRollback(input: RollbackDeploymentInput): Promise<DeploymentRow | null> {
    this.calls.push(input);
    if (this.#behaviour.runError) {
      return Promise.reject(this.#behaviour.runError);
    }
    return Promise.resolve(this.#behaviour.row ?? null);
  }
}

/**
 * `state_changed_at` follows `created_at` unless a case says otherwise: an app nobody has
 * suspended last moved when it was created, which is before every deployment it has.
 */
function liveRow(overrides: Partial<LiveDeploymentRow> = {}): LiveDeploymentRow {
  const createdAt = overrides.created_at ?? new Date();
  return {
    id: DEPLOYMENT_ID,
    state: 'pending' as DeploymentState,
    created_at: createdAt,
    state_changed_at: createdAt,
    desired_running: true,
    ...overrides,
  };
}

function instance({
  state,
  ...overrides
}: Partial<ReportedInstance> & { state: InstanceState }): ReportedInstance {
  return {
    appId: APP_ID,
    deploymentId: DEPLOYMENT_ID,
    state,
    restartCount: 0,
    ...overrides,
  };
}

function report(instances: ReportedInstance[]): HostReportedState {
  return { instances, reportedAt: REPORTED_AT.toISOString() } as unknown as HostReportedState;
}

function serviceWith(behaviour: FakeBehaviour = {}) {
  const deploymentsRepo = new FakeDeploymentsRepository(behaviour);
  return { deploymentsRepo, service: new DeploymentsService({ deploymentsRepo }) };
}

describe('a deployment publishes the config version it pins', () => {
  test('the pinned config reaches the wire, its variables named but not readable', async () => {
    const { service } = serviceWith({ row: deploymentRow() });

    const deployment = await service.createOrRollback({
      appId: APP_ID,
      ownerId: OWNER_ID,
      source: { artifactId: ARTIFACT_ID },
    });

    expect(deployment.config).toEqual({
      volumeSizeBytes: VOLUME_SIZE_BYTES,
      environment: {},
      httpPort: HTTP_PORT,
      args: ['serve'],
      resources: DEFAULT_INSTANCE_RESOURCES,
      healthCheck: DEFAULT_HEALTH_CHECK,
      restartPolicy: DEFAULT_RESTART_POLICY,
    });
  });

  test('columns become the wire shape the protocol describes', async () => {
    const { service } = serviceWith({ row: deploymentRow() });

    expect(await service.get(OWNED_DEPLOYMENT)).toMatchObject({
      id: DEPLOYMENT_ID,
      appId: APP_ID,
      artifactId: ARTIFACT_ID,
      state: 'pending',
      createdAt: CREATED_AT.toISOString(),
    });
  });

  // `activatedAt` is optional on the wire, so a deployment that has never run must omit it
  // rather than publish a null the schema would reject.
  test('a deployment that has never run carries no activation instant', async () => {
    const { service } = serviceWith({ row: deploymentRow() });

    expect('activatedAt' in (await service.get(OWNED_DEPLOYMENT))).toBe(false);
  });

  test('and one that has carries it as an ISO instant', async () => {
    const { service } = serviceWith({
      row: deploymentRow({ state: 'active', activated_at: ACTIVATED_AT }),
    });

    const deployment = await service.get(OWNED_DEPLOYMENT);

    expect(deployment.activatedAt).toBe(Value.Parse(TimestampSchema, ACTIVATED_AT.toISOString()));
  });

  test('what a host observed of the microVM reaches the wire', async () => {
    const { service } = serviceWith({
      row: deploymentRow({
        state: 'active',
        started_at: STARTED_AT,
        activated_at: ACTIVATED_AT,
        last_healthy_at: LAST_HEALTHY_AT,
        restart_count: RESTART_COUNT,
      }),
    });

    expect(await service.get(OWNED_DEPLOYMENT)).toMatchObject({
      startedAt: STARTED_AT.toISOString(),
      lastHealthyAt: LAST_HEALTHY_AT.toISOString(),
      restartCount: RESTART_COUNT,
    });
  });

  // Every instant is optional on the wire, so one a release has not reached is omitted rather
  // than published as a null the schema would reject.
  test('and the instants it never reached are omitted', async () => {
    const deployment = await serviceWith({ row: deploymentRow() }).service.get(OWNED_DEPLOYMENT);

    expect('startedAt' in deployment).toBe(false);
    expect('lastHealthyAt' in deployment).toBe(false);
    expect(deployment.restartCount).toBe(0);
  });

  test('a release that failed publishes what the host said about it', async () => {
    const { service } = serviceWith({
      row: deploymentRow({ state: 'failed', message: FAILURE_MESSAGE }),
    });

    expect((await service.get(OWNED_DEPLOYMENT)).message).toBe(FAILURE_MESSAGE);
  });

  // Optional on the wire like `activatedAt`, so a release with nothing to say omits it rather
  // than publishing a null the schema would reject.
  test('and one with nothing to say about itself omits it', async () => {
    const { service } = serviceWith({ row: deploymentRow() });

    expect('message' in (await service.get(OWNED_DEPLOYMENT))).toBe(false);
  });
});

describe('an app the caller does not own is indistinguishable from one that does not exist', () => {
  test('creating against an unowned app or a foreign artifact is a 404, never a 403', async () => {
    const { service } = serviceWith({ row: null });

    await expect(
      service.createOrRollback({
        appId: APP_ID,
        ownerId: OWNER_ID,
        source: { artifactId: ARTIFACT_ID },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('fetching one is too', async () => {
    const { service } = serviceWith({ row: null });

    await expect(service.get(OWNED_DEPLOYMENT)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('going back to one belonging to another app is too', async () => {
    const { service } = serviceWith({ row: null });

    await expect(service.createOrRollback(ROLLBACK_REQUEST)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listing yields nothing rather than another owner's rows", async () => {
    const { service } = serviceWith({ rows: [] });

    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([]);
  });

  // The owner is a predicate the database applies, so a service that forgets to pass it down
  // turns every query into a cross-tenant read.
  test('every call carries the owner down to the query', async () => {
    const { deploymentsRepo, service } = serviceWith({ row: deploymentRow(), rows: [] });

    await service.createOrRollback({
      appId: APP_ID,
      ownerId: OWNER_ID,
      source: { artifactId: ARTIFACT_ID },
    });
    await service.list({ appId: APP_ID, ownerId: OWNER_ID });
    await service.get(OWNED_DEPLOYMENT);
    await service.createOrRollback(ROLLBACK_REQUEST);

    expect(deploymentsRepo.calls).toHaveLength(OWNER_SCOPED_METHODS);
    for (const call of deploymentsRepo.calls) {
      expect(call.ownerId).toBe(OWNER_ID);
    }
  });
});

describe('creating a deployment is asking for it to run', () => {
  // There is no second call that means it, so a caller that never activates still gets a deploy
  // rather than a row nobody looks at.
  test('a new deployment comes back pending rather than stopped', async () => {
    const { service } = serviceWith({ row: deploymentRow({ state: 'pending' }) });

    const deployment = await service.createOrRollback({
      appId: APP_ID,
      ownerId: OWNER_ID,
      source: { artifactId: ARTIFACT_ID },
    });

    expect(deployment.state).toBe('pending');
  });

  // Same index, same race, whichever call is asking: creating now claims the running slot too.
  test('losing the race while creating is a conflict, not a 500', async () => {
    const { service } = serviceWith({
      runError: uniqueViolation(schema.deployments._indexes.deployments_live_idx._indexName),
    });

    await expect(
      service.createOrRollback({
        appId: APP_ID,
        ownerId: OWNER_ID,
        source: { artifactId: ARTIFACT_ID },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('a host reporting is what moves a release through its states', () => {
  test('the first connection the tenant accepts is what makes the deployment active', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow()] });

    await service.applyHostReport({ reported: report([instance({ state: 'running' })]) });

    expect(deploymentsRepo.applied).toEqual([
      expect.objectContaining({ deploymentId: DEPLOYMENT_ID, state: 'active' }),
    ]);
  });

  // The probe the host answered, not the moment this end got round to reading about it: a report
  // arrives up to an interval late, and the api's clock is not the one that saw it happen.
  test("the instant it began serving is the host's, not this end's", async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow()] });

    await service.applyHostReport({
      reported: report([
        instance({
          state: 'running',
          lastHealthyAt: Value.Parse(TimestampSchema, HEALTHY_AT.toISOString()),
        }),
      ]),
    });

    expect(deploymentsRepo.activations).toEqual([{ deploymentId: DEPLOYMENT_ID, at: HEALTHY_AT }]);
  });

  // Unreachable while a host only reports `running` for an instance that answered a probe, so
  // this is what a host drifting from that contract lands on rather than a null hole.
  test('a report with no healthy instant falls back to when the host sent it', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow()] });

    await service.applyHostReport({ reported: report([instance({ state: 'running' })]) });

    expect(deploymentsRepo.activations[0]?.at).toEqual(REPORTED_AT);
  });

  test('one that has not served is not stamped as having done so', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow()] });

    await service.applyHostReport({ reported: report([instance({ state: 'starting' })]) });

    expect(deploymentsRepo.activations).toEqual([]);
  });

  // The reported columns are written on every heartbeat; this one is not, or it would creep
  // forward with each probe and end up saying when the app was last healthy.
  test('one already active is not stamped a second time', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow({ state: 'active' })] });

    await service.applyHostReport({ reported: report([instance({ state: 'running' })]) });

    expect(deploymentsRepo.activations).toEqual([]);
    expect(deploymentsRepo.applied).toHaveLength(1);
  });

  // They move without the state moving — a running instance reports a restart count and a health
  // instant on every heartbeat — so they cannot ride along only on a transition.
  test('what the host observed lands even when the state does not move', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow({ state: 'active' })] });

    await service.applyHostReport({
      reported: report([
        instance({
          state: 'running',
          hostPort: HOST_PORT,
          guestIpv4: GUEST_IPV4,
          restartCount: RESTART_COUNT,
          lastHealthyAt: Value.Parse(TimestampSchema, HEALTHY_AT.toISOString()),
        }),
      ]),
    });

    expect(deploymentsRepo.applied).toEqual([
      expect.objectContaining({
        state: 'active',
        hostPort: HOST_PORT,
        guestIpv4: GUEST_IPV4,
        restartCount: RESTART_COUNT,
        lastHealthyAt: HEALTHY_AT,
      }),
    ]);
  });

  // Knowable only from the deployments the report left out, which is why every live row is
  // considered rather than only the ones a host mentioned.
  test('one no instance ever appeared for is failed on its deadline', async () => {
    const { deploymentsRepo, service } = serviceWith({
      live: [liveRow({ created_at: new Date(Date.now() - STARTUP_DEADLINE_MS) })],
    });

    await service.applyHostReport({ reported: report([]) });

    expect(deploymentsRepo.failed).toEqual([DEPLOYMENT_ID]);
    expect(deploymentsRepo.applied).toEqual([]);
  });

  test('and left alone while it is still within it', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [liveRow()] });

    await service.applyHostReport({ reported: report([]) });

    expect(deploymentsRepo.failed).toEqual([]);
  });

  // A report assembled before a redeploy landed still names the row that redeploy superseded.
  test('a report about a deployment no longer live writes nothing', async () => {
    const { deploymentsRepo, service } = serviceWith({ live: [] });

    await service.applyHostReport({ reported: report([instance({ state: 'running' })]) });

    expect(deploymentsRepo.applied).toEqual([]);
    expect(deploymentsRepo.failed).toEqual([]);
  });
});

describe('going back to a release is a new deployment, not an old one revived', () => {
  // Which of the two the body is saying is the whole difference, so this is what proves the
  // service reads it rather than treating every request as a fresh artifact.
  test('naming a deployment replays it rather than deploying an artifact', async () => {
    const { deploymentsRepo, service } = serviceWith({ row: deploymentRow() });

    await service.createOrRollback(ROLLBACK_REQUEST);

    expect(deploymentsRepo.calls).toEqual([
      { appId: APP_ID, ownerId: OWNER_ID, rollbackOf: DEPLOYMENT_ID },
    ]);
  });

  // The row it replays keeps its own state and its own history; this is a new release that
  // happens to run what that one ran.
  test('the rollback is its own row, naming the one it replays', async () => {
    const { service } = serviceWith({
      row: deploymentRow({ rollback_of_deployment_id: DEPLOYMENT_ID }),
    });

    expect((await service.createOrRollback(ROLLBACK_REQUEST)).rollbackOf).toBe(DEPLOYMENT_ID);
  });

  // Two callers racing meet the partial unique index, not each other. The loser is told to
  // retry rather than left believing it won.
  test('losing the race to the live index is a conflict, not a 500', async () => {
    const { service } = serviceWith({
      runError: uniqueViolation(schema.deployments._indexes.deployments_live_idx._indexName),
    });

    await expect(service.createOrRollback(ROLLBACK_REQUEST)).rejects.toBeInstanceOf(ConflictError);
  });

  test('any other database failure is not disguised as one', async () => {
    const boom = new Error('connection reset');
    const { service } = serviceWith({ runError: boom });

    await expect(service.createOrRollback(ROLLBACK_REQUEST)).rejects.toBe(boom);
  });
});

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HEALTH_CHECK,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_RESTART_POLICY,
  type GuestPort,
  type Timestamp,
} from '@repo/protocol';
import { type PublicAppConfig, VOLUME_SIZE_BYTES } from '#lib/app-config.ts';
import { ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  CreateDeploymentInput,
  DeploymentByIdInput,
  DeploymentRow,
  DeploymentsByAppInput,
  DeploymentsRepositoryContract,
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

const GUEST_PORT = 8090 as GuestPort;
const OWNER_SCOPED_METHODS = 4;
const CREATED_AT = new Date('2026-08-04T10:00:00.000Z');
const ACTIVATED_AT = new Date('2026-08-04T11:30:00.000Z');

// The config version this deployment pins. `app_configs` never changes a row, so this is what
// the deployment was launched with however the app has since been reconfigured.
const PINNED_CONFIG: PublicAppConfig = {
  ...DEFAULT_CONFIG,
  guestPort: GUEST_PORT,
  args: ['serve'],
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
    created_at: CREATED_AT,
    ...configColumns(PINNED_CONFIG),
    ...overrides,
  };
}

type FakeBehaviour = {
  rows?: DeploymentRow[];
  row?: DeploymentRow | null;
  runError?: unknown;
};

class FakeDeploymentsRepository implements DeploymentsRepositoryContract {
  readonly calls: Array<Record<string, unknown>> = [];
  readonly #behaviour: FakeBehaviour;

  constructor(behaviour: FakeBehaviour = {}) {
    this.#behaviour = behaviour;
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

  applyReport(): Promise<void> {
    return Promise.resolve();
  }

  activate(input: DeploymentByIdInput): Promise<DeploymentRow | null> {
    this.calls.push(input);
    if (this.#behaviour.runError) {
      return Promise.reject(this.#behaviour.runError);
    }
    return Promise.resolve(this.#behaviour.row ?? null);
  }
}

function serviceWith(behaviour: FakeBehaviour = {}) {
  const deploymentsRepo = new FakeDeploymentsRepository(behaviour);
  return { deploymentsRepo, service: new DeploymentsService({ deploymentsRepo }) };
}

describe('a deployment publishes the config version it pins', () => {
  test('the pinned config reaches the wire, and carries no environment to leak', async () => {
    const { service } = serviceWith({ row: deploymentRow() });

    const deployment = await service.create({
      appId: APP_ID,
      artifactId: ARTIFACT_ID,
      ownerId: OWNER_ID,
    });

    expect(deployment.config).toEqual({
      volumeSizeBytes: VOLUME_SIZE_BYTES,
      guestPort: GUEST_PORT,
      args: ['serve'],
      resources: DEFAULT_INSTANCE_RESOURCES,
      healthCheck: DEFAULT_HEALTH_CHECK,
      restartPolicy: DEFAULT_RESTART_POLICY,
    });
    expect('environment' in deployment.config).toBe(false);
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

    expect(deployment.activatedAt).toBe(ACTIVATED_AT.toISOString() as Timestamp);
  });
});

describe('an app the caller does not own is indistinguishable from one that does not exist', () => {
  test('creating against an unowned app or a foreign artifact is a 404, never a 403', async () => {
    const { service } = serviceWith({ row: null });

    await expect(
      service.create({ appId: APP_ID, artifactId: ARTIFACT_ID, ownerId: OWNER_ID }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test('fetching one is too', async () => {
    const { service } = serviceWith({ row: null });

    await expect(service.get(OWNED_DEPLOYMENT)).rejects.toBeInstanceOf(NotFoundError);
  });

  test('activating one is too', async () => {
    const { service } = serviceWith({ row: null });

    await expect(service.activate(OWNED_DEPLOYMENT)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("listing yields nothing rather than another owner's rows", async () => {
    const { service } = serviceWith({ rows: [] });

    expect(await service.list({ appId: APP_ID, ownerId: OWNER_ID })).toEqual([]);
  });

  // The owner is a predicate the database applies, so a service that forgets to pass it down
  // turns every query into a cross-tenant read.
  test('every call carries the owner down to the query', async () => {
    const { deploymentsRepo, service } = serviceWith({ row: deploymentRow(), rows: [] });

    await service.create({ appId: APP_ID, artifactId: ARTIFACT_ID, ownerId: OWNER_ID });
    await service.list({ appId: APP_ID, ownerId: OWNER_ID });
    await service.get(OWNED_DEPLOYMENT);
    await service.activate(OWNED_DEPLOYMENT);

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

    const deployment = await service.create({
      appId: APP_ID,
      artifactId: ARTIFACT_ID,
      ownerId: OWNER_ID,
    });

    expect(deployment.state).toBe('pending');
  });

  // Same index, same race, whichever call is asking: creating now claims the running slot too.
  test('losing the race while creating is a conflict, not a 500', async () => {
    const { service } = serviceWith({ runError: uniqueViolation('deployments_live_idx') });

    await expect(
      service.create({ appId: APP_ID, artifactId: ARTIFACT_ID, ownerId: OWNER_ID }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('one app runs one deployment at a time', () => {
  // A host has to boot it and say so. Answering `active` the moment the request lands would
  // report a deploy that has not happened, and a caller polling for it would never learn.
  test('what comes back is the observed state, not the one asked for', async () => {
    const { service } = serviceWith({ row: deploymentRow({ state: 'pending' }) });

    expect((await service.activate(OWNED_DEPLOYMENT)).state).toBe('pending');
  });

  // Two callers racing meet the partial unique index, not each other. The loser is told to
  // retry rather than left believing it won.
  test('losing the race to the live index is a conflict, not a 500', async () => {
    const { service } = serviceWith({ runError: uniqueViolation('deployments_live_idx') });

    await expect(service.activate(OWNED_DEPLOYMENT)).rejects.toBeInstanceOf(ConflictError);
  });

  test('any other database failure is not disguised as one', async () => {
    const boom = new Error('connection reset');
    const { service } = serviceWith({ runError: boom });

    await expect(service.activate(OWNED_DEPLOYMENT)).rejects.toBe(boom);
  });
});

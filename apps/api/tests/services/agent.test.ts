import { describe, expect, test } from 'bun:test';
import {
  type AgentSessionRequest,
  type AppId,
  DesiredInstanceSchema,
  type Filename,
  type GuestPort,
  type HostCapacity,
  type Hostname,
  type HostReportedState,
  type HostVersions,
  isValidMessage,
  type ObjectKey,
  type ReportedInstance,
  type SecretString,
  type Sha256Digest,
} from '@repo/protocol';
import { VOLUME_SIZE_BYTES } from '#lib/app-config.ts';
import { THE_APP_HOST } from '#lib/desired-state.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type {
  AppVolumeRow,
  DeployedHostnameRow,
  DesiredStateRepositoryContract,
  RunningDeploymentRow,
} from '#repositories/desired-state.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import {
  APP_ID,
  configColumns,
  DEFAULT_CONFIG,
  DEPLOYMENT_ID,
} from '#tests/services/support/fixtures.ts';

const OTHER_APP_ID = 'app-2' as AppId;
const DEMO_HOSTNAME = 'demo.apps.test' as Hostname;
const GENERATION = 7;
const SHA256_HEX_LENGTH = 64;
const DIGEST = 'f'.repeat(SHA256_HEX_LENGTH) as Sha256Digest;
const ARTIFACT_SIZE_BYTES = 32_096_418;
const GUEST_PORT = 8090 as GuestPort;

const versions: HostVersions = {
  agent: 'abc123',
  guestImage: '6.1.180',
  zerofs: 'v2.2.1',
  firecracker: 'v1.16.1',
} as HostVersions;

const capacity: HostCapacity = { vcpuCount: 2, memoryMib: 8192, cacheBytes: 100_000_000_000 };

function deploymentRow(overrides: Partial<RunningDeploymentRow> = {}): RunningDeploymentRow {
  return {
    id: DEPLOYMENT_ID,
    app_id: APP_ID,
    digest: DIGEST,
    size_bytes: String(ARTIFACT_SIZE_BYTES),
    object_key: DIGEST as string as ObjectKey,
    original_file_name: 'pocketbase' as Filename,
    ...configColumns({ ...DEFAULT_CONFIG, guestPort: GUEST_PORT }),
    ...overrides,
  };
}

class FakeAgentRepository implements AgentRepositoryContract {
  readonly #sessions = new Map<string, ReturnType<() => typeof THE_APP_HOST>>();

  saveSession({
    sessionToken,
    hostId,
  }: {
    sessionToken: SecretString;
    hostId: typeof THE_APP_HOST;
  }) {
    this.#sessions.set(sessionToken, hostId);
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }) {
    return Promise.resolve(this.#sessions.get(sessionToken));
  }
}

type FleetRows = {
  deployments?: RunningDeploymentRow[];
  volumes?: AppVolumeRow[];
  hostnames?: DeployedHostnameRow[];
};

class FakeDesiredStateRepository implements DesiredStateRepositoryContract {
  readonly #rows: FleetRows;

  constructor(rows: FleetRows = {}) {
    this.#rows = rows;
  }

  generation(): Promise<number> {
    return Promise.resolve(GENERATION);
  }

  runningDeployments(): Promise<RunningDeploymentRow[]> {
    return Promise.resolve(this.#rows.deployments ?? []);
  }

  appVolumes(): Promise<AppVolumeRow[]> {
    return Promise.resolve(this.#rows.volumes ?? []);
  }

  deployedHostnames(): Promise<DeployedHostnameRow[]> {
    return Promise.resolve(this.#rows.hostnames ?? []);
  }
}

class FakeDeploymentsRepository {
  readonly reported: ReportedInstance[][] = [];

  applyReport({ instances }: { instances: ReportedInstance[] }): Promise<void> {
    this.reported.push(instances);
    return Promise.resolve();
  }
}

function build(rows: FleetRows = {}) {
  const deploymentsRepo = new FakeDeploymentsRepository();
  return {
    deploymentsRepo,
    service: new AgentService({
      agentRepo: new FakeAgentRepository(),
      desiredStateRepo: new FakeDesiredStateRepository(rows),
      deploymentsRepo,
    }),
  };
}

const sessionRequest: AgentSessionRequest = { versions, capacity };

function desiredFor(rows: FleetRows) {
  return build(rows).service.desiredState({ hostId: THE_APP_HOST });
}

describe('a host is told what to run, from rows rather than a fixture', () => {
  // The fleet is one machine, so a host presenting some other identity is still that machine.
  test('every session names the one host, whatever the agent presents', async () => {
    const { service } = build();

    const session = await service.openSession({
      ...sessionRequest,
      hostId: 'host-from-a-reinstall' as typeof THE_APP_HOST,
    });

    expect(session.hostId).toBe(THE_APP_HOST);
  });

  test('a session resolves back to the host that opened it', async () => {
    const { service } = build();

    const session = await service.openSession(sessionRequest);

    expect(await service.hostForSession({ sessionToken: session.sessionToken })).toBe(THE_APP_HOST);
  });

  // One deployment is one microVM, so these are the same id rather than two things to keep in
  // step. A host that saw them diverge would boot a second VM for the same deployment.
  test('the instance a host is told to run is the deployment itself', async () => {
    const { instances } = await desiredFor({ deployments: [deploymentRow()] });

    expect(instances[0]?.instanceId as string).toBe(DEPLOYMENT_ID);
    expect(instances[0]?.deploymentId).toBe(DEPLOYMENT_ID);
  });

  test('an instance carries the artifact, the pinned config and the app hostnames', async () => {
    const { instances } = await desiredFor({
      deployments: [deploymentRow()],
      hostnames: [{ app_id: APP_ID, hostname: DEMO_HOSTNAME, kind: 'platform' }],
    });

    expect(instances[0]).toMatchObject({
      appId: APP_ID,
      desiredState: 'running',
      artifact: { digest: DIGEST, sizeBytes: ARTIFACT_SIZE_BYTES, filename: 'pocketbase' },
      hostnames: [{ hostname: DEMO_HOSTNAME, kind: 'platform' }],
    });
    expect(instances[0]?.config.guestPort).toBe(GUEST_PORT);
  });

  // The agent parses what it is given against this schema and refuses the message on a
  // mismatch, so a shape that is merely close enough is a host that converges on nothing.
  test('what comes back is what the protocol says an instance is', async () => {
    const { instances } = await desiredFor({ deployments: [deploymentRow()] });

    expect(isValidMessage({ schema: DesiredInstanceSchema, value: instances[0] })).toBe(true);
  });

  // Secrets storage is deferred, so there is nothing to send. An absent field would fail the
  // agent's own validation, which is why this is empty rather than missing.
  test('a guest is given an empty environment rather than none at all', async () => {
    const { instances } = await desiredFor({ deployments: [deploymentRow()] });

    expect(instances[0]?.config.environment).toEqual({});
  });

  test('an app only ever sees its own hostnames', async () => {
    const { instances } = await desiredFor({
      deployments: [deploymentRow()],
      hostnames: [
        { app_id: OTHER_APP_ID, hostname: 'other.apps.test' as Hostname, kind: 'platform' },
        { app_id: APP_ID, hostname: DEMO_HOSTNAME, kind: 'platform' },
      ],
    });

    expect(instances[0]?.hostnames).toEqual([{ hostname: DEMO_HOSTNAME, kind: 'platform' }]);
  });

  // One filesystem per app and nothing storing the pairing, so the two ids are the same string.
  test("a volume is the app's, at the size the api chose", async () => {
    const { volumes } = await desiredFor({ volumes: [{ id: APP_ID, state: 'active' }] });

    expect(volumes).toEqual([
      {
        volumeId: APP_ID as string as (typeof volumes)[number]['volumeId'],
        appId: APP_ID,
        sizeBytes: VOLUME_SIZE_BYTES,
        desiredState: 'present',
      },
    ]);
  });

  // A truncated list must never read as "delete the filesystem", so removal is only ever the
  // explicit `absent` and an app on its way out stays in the list to carry it.
  test('a volume is present until its app is going, and only then absent', async () => {
    const { volumes } = await desiredFor({
      volumes: [
        { id: APP_ID, state: 'active' },
        { id: OTHER_APP_ID, state: 'deleting' },
      ],
    });

    expect(volumes.map((volume) => volume.desiredState)).toEqual(['present', 'absent']);
  });

  test('a fleet with nothing on it is told there is nothing, not left to guess', async () => {
    expect(await desiredFor({})).toEqual({
      hostId: THE_APP_HOST,
      generation: GENERATION,
      volumes: [],
      instances: [],
      checkpoints: [],
      exports: [],
    });
  });
});

describe('a report is what moves a deployment, not the request that asked for it', () => {
  const instance = {
    instanceId: DEPLOYMENT_ID,
    deploymentId: DEPLOYMENT_ID,
    state: 'running',
    restartCount: 0,
  } as unknown as ReportedInstance;

  const report = {
    hostId: THE_APP_HOST,
    observedGeneration: GENERATION,
    reportedAt: new Date('2026-08-05T12:00:00.000Z').toISOString(),
    state: 'ready',
    capacity,
    allocatable: capacity,
    versions,
    volumes: [],
    instances: [instance],
    checkpoints: [],
    exports: [],
  } as unknown as HostReportedState;

  test('what the host says about its microVMs reaches the deployments', async () => {
    const { deploymentsRepo, service } = build();

    await service.acceptReport({ reported: report });

    expect(deploymentsRepo.reported).toEqual([[instance]]);
  });
});

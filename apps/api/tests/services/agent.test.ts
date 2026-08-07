import { describe, expect, test } from 'bun:test';
import {
  type AgentSessionRequest,
  type HostDesiredState,
  type HostId,
  HostIdSchema,
  type HostReportedState,
  type ReportedVolume,
  type SecretString,
  Value,
} from '@repo/protocol';
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { ExportsService } from '#services/exports.service.ts';

const SESSION_REQUEST = {
  versions: { agent: 'abc123', guestImage: 'linux-6.1', zerofs: 'v2', firecracker: 'v1' },
  capacity: { vcpuCount: 2, memoryMib: 8192, cacheBytes: 100_000_000_000 },
} as unknown as AgentSessionRequest;

class FakeAgentRepository implements AgentRepositoryContract {
  readonly #hostBySession = new Map<string, HostId>();

  saveSession({
    sessionToken,
    hostId,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
  }): Promise<void> {
    this.#hostBySession.set(sessionToken, hostId);
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#hostBySession.get(sessionToken));
  }

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    return Promise.resolve({
      hostId,
      volumes: [],
      instances: [],
      checkpoints: [],
      exports: [],
    });
  }
}

class FakeAppsService {
  readonly volumes: ReportedVolume[][] = [];
  readonly trace: string[] = [];

  completeDeletions({ volumes }: { volumes: readonly ReportedVolume[] }): Promise<void> {
    this.volumes.push([...volumes]);
    this.trace.push('completeDeletions');
    return Promise.resolve();
  }

  finishDeletions(): Promise<void> {
    this.trace.push('finishDeletions');
    return Promise.resolve();
  }

  purgeDeleted(): Promise<void> {
    this.trace.push('purgeDeleted');
    return Promise.resolve();
  }
}

class FakeDeploymentsService {
  readonly reports: HostReportedState[] = [];

  applyHostReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.reports.push(reported);
    return Promise.resolve();
  }
}

class FakeExportsService {
  readonly reports: HostReportedState[] = [];

  applyHostReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.reports.push(reported);
    return Promise.resolve();
  }
}

function build() {
  const deployments = new FakeDeploymentsService();
  const apps = new FakeAppsService();
  const exports = new FakeExportsService();
  return {
    apps,
    deployments,
    exports,
    service: new AgentService({
      agentRepo: new FakeAgentRepository(),
      deploymentsService: deployments as unknown as DeploymentsService,
      appsService: apps as unknown as AppsService,
      exportsService: exports as unknown as ExportsService,
    }),
  };
}

describe('a session is the identity a host is answered as', () => {
  test('a host presenting its own id keeps it across a reinstall', async () => {
    const { service } = build();
    const hostId = Value.Parse(HostIdSchema, 'host-of-record');

    expect((await service.openSession({ ...SESSION_REQUEST, hostId })).hostId).toBe(hostId);
  });

  test('one that has never registered is given an id to persist', async () => {
    const { service } = build();

    expect((await service.openSession(SESSION_REQUEST)).hostId).toBeTruthy();
  });

  // A default host would hand desired state to anything that reached the port.
  test('an unknown token is refused rather than resolved to a host', async () => {
    const { service } = build();

    await expect(service.hostForSession({ sessionToken: 'not-a-session' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('a host is told the whole of what it should be running', () => {
  // Desired state carries no host id of its own, so a host can only ever be told about itself.
  test('and told it about itself', async () => {
    const { service } = build();
    const hostId = Value.Parse(HostIdSchema, 'host-1');

    expect(await service.desiredState({ hostId })).toEqual({
      hostId,
      volumes: [],
      instances: [],
      checkpoints: [],
      exports: [],
    });
  });
});

describe('a report is read by whatever owns what it talks about', () => {
  test('and by each of them, so no part of it is dropped on the way in', async () => {
    const { deployments, exports, service } = build();
    const reported = {
      hostId: Value.Parse(HostIdSchema, 'host-1'),
      instances: [],
      volumes: [],
      exports: [],
    } as unknown as HostReportedState;

    await service.acceptReport({ reported });

    expect(deployments.reports).toEqual([reported]);
    expect(exports.reports).toEqual([reported]);
  });

  // What a deleted app left behind is only safe to remove once a host has said the filesystem is
  // gone, and that is what taking the report in records. A deletion finished on the way past is
  // then purged by the same report rather than by the next one.
  test('and only then is what the deleted ones left behind cleaned up', async () => {
    const { apps, service } = build();
    const reported = {
      hostId: Value.Parse(HostIdSchema, 'host-1'),
      instances: [],
      volumes: [],
      exports: [],
    } as unknown as HostReportedState;

    await service.acceptReport({ reported });

    expect(apps.trace).toEqual(['completeDeletions', 'finishDeletions', 'purgeDeleted']);
  });
});

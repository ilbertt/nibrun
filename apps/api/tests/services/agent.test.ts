import { describe, expect, test } from 'bun:test';
import type {
  AgentSessionRequest,
  HostDesiredState,
  HostId,
  HostReportedState,
  SecretString,
} from '@repo/protocol';
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import { AgentService } from '#services/agent.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';

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

class FakeDeploymentsService {
  readonly reports: HostReportedState[] = [];

  applyHostReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.reports.push(reported);
    return Promise.resolve();
  }
}

function build() {
  const deployments = new FakeDeploymentsService();
  return {
    deployments,
    service: new AgentService({
      agentRepo: new FakeAgentRepository(),
      deploymentsService: deployments as unknown as DeploymentsService,
    }),
  };
}

describe('a session is the identity a host is answered as', () => {
  test('a host presenting its own id keeps it across a reinstall', async () => {
    const { service } = build();
    const hostId = 'host-of-record' as HostId;

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
    const hostId = 'host-1' as HostId;

    expect(await service.desiredState({ hostId })).toEqual({
      hostId,
      volumes: [],
      instances: [],
      checkpoints: [],
      exports: [],
    });
  });
});

describe('a report is read for what it says about deployments', () => {
  test('and nothing else, because nothing else has a table to land in', async () => {
    const { deployments, service } = build();
    const reported = {
      hostId: 'host-1' as HostId,
      instances: [],
      volumes: [],
    } as unknown as HostReportedState;

    await service.acceptReport({ reported });

    expect(deployments.reports).toEqual([reported]);
  });
});

import { describe, expect, spyOn, test } from 'bun:test';
import {
  AgentSessionRequestSchema,
  type HostDesiredState,
  type HostId,
  HostIdSchema,
  type HostReportedState,
  type ReportedVolume,
  type SecretString,
} from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { AgentSessions } from '#lib/agent/sessions.ts';
import { ForbiddenError, UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract, HostObservation } from '#repositories/agent.repository.ts';
import {
  AgentService,
  type HostnameReconcileServiceContract,
  type ImportSweepServiceContract,
} from '#services/agent.service.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { ExportsService } from '#services/exports.service.ts';

const SESSION_REQUEST = Value.Parse(AgentSessionRequestSchema, {
  hostId: 'agent-origin',
  versions: { agent: 'abc123', guestImage: 'linux-6.1', zerofs: 'v2', firecracker: 'v1' },
  capacity: { vcpuCount: 2, memoryMib: 8192, cacheBytes: 100_000_000_000 },
});

class FakeAgentRepository implements AgentRepositoryContract {
  readonly registeredOrigins: string[] = [];
  readonly hosts = new Map<string, HostId>();
  readonly #sessions = new AgentSessions();
  observed: HostObservation | undefined;
  sessionExpiresAt: Date | undefined;

  registerHost({ originId }: { originId: string }): Promise<HostId> {
    this.registeredOrigins.push(originId);
    const hostId = this.hosts.get(originId) ?? Value.Parse(HostIdSchema, Bun.randomUUIDv7());
    this.hosts.set(originId, hostId);
    this.hosts.set(hostId, hostId);
    return Promise.resolve(hostId);
  }

  hostForIdentity({ identity }: { identity: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.hosts.get(identity));
  }

  saveSession({
    sessionToken,
    hostId,
    expiresAt,
  }: {
    sessionToken: SecretString;
    hostId: HostId;
    expiresAt: Date;
  }): Promise<void> {
    this.sessionExpiresAt = expiresAt;
    this.#sessions.open({ sessionToken, hostId, expiresAt });
    return Promise.resolve();
  }

  hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId | undefined> {
    return Promise.resolve(this.#sessions.hostFor({ sessionToken, now: new Date() }));
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

  observeReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.observed = {
      hostId: reported.hostId,
      reportedAt: reported.reportedAt,
      state: reported.state,
    };
    return Promise.resolve();
  }

  lastObservation(): Promise<HostObservation | undefined> {
    return Promise.resolve(this.observed);
  }
}

class FakeAppsService {
  readonly volumes: ReportedVolume[][] = [];
  readonly trace: string[] = [];

  recordComputeUsage(): Promise<void> {
    this.trace.push('recordComputeUsage');
    return Promise.resolve();
  }

  recordVolumeUsage(): Promise<void> {
    this.trace.push('recordVolumeUsage');
    return Promise.resolve();
  }

  recordDataInitialized(): Promise<void> {
    this.trace.push('recordDataInitialized');
    return Promise.resolve();
  }

  completeDeletions({ volumes }: { volumes: readonly ReportedVolume[] }): Promise<void> {
    this.volumes.push([...volumes]);
    this.trace.push('completeDeletions');
    return Promise.resolve();
  }

  expire(): Promise<void> {
    this.trace.push('expire');
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

/** A report is the only clock this process has, so the sweep rides along on one. */
class FakeImportSweepService implements ImportSweepServiceContract {
  swept = 0;
  sweptSpent = 0;

  sweepAbandoned(): Promise<void> {
    this.swept += 1;
    return Promise.resolve();
  }

  sweepSpent(): Promise<void> {
    this.sweptSpent += 1;
    return Promise.resolve();
  }
}

/** The same clock, borrowed for the hostnames whose fate is decided in somebody else's DNS. */
class FakeHostnameReconcileService implements HostnameReconcileServiceContract {
  reconciled = 0;

  reconcile(): Promise<void> {
    this.reconciled += 1;
    return Promise.resolve();
  }
}

function build() {
  const agentRepo = new FakeAgentRepository();
  const deployments = new FakeDeploymentsService();
  const apps = new FakeAppsService();
  const exports = new FakeExportsService();
  const artifacts = new FakeImportSweepService();
  const imports = new FakeImportSweepService();
  const hostnames = new FakeHostnameReconcileService();
  const volumeStorageMigrations = new FakeImportSweepService();
  return {
    agentRepo,
    apps,
    deployments,
    exports,
    artifacts,
    imports,
    hostnames,
    volumeStorageMigrations,
    service: new AgentService({
      agentRepo,
      deploymentsService: deployments as unknown as DeploymentsService,
      appsService: apps as unknown as AppsService,
      exportsService: exports as unknown as ExportsService,
      artifactsService: artifacts,
      importsService: imports,
      hostnamesService: hostnames,
      volumeStorageMigrationsService: volumeStorageMigrations,
    }),
  };
}

describe('a session is the identity a host is answered as', () => {
  test('an origin identity and its returned canonical id renew the same host', async () => {
    const { service, agentRepo } = build();
    const hostId = Value.Parse(HostIdSchema, 'host-of-record');

    const session = await service.openSession({ ...SESSION_REQUEST, hostId });
    expect(session.hostId).not.toBe(hostId);
    expect((await service.openSession({ ...SESSION_REQUEST, hostId })).hostId).toBe(session.hostId);
    expect((await service.openSession({ ...SESSION_REQUEST, hostId: session.hostId })).hostId).toBe(
      session.hostId,
    );
    expect(agentRepo.registeredOrigins).toEqual([hostId, hostId, session.hostId]);
  });

  test('a new origin receives a canonical host id', async () => {
    const { service, agentRepo } = build();

    const session = await service.openSession(SESSION_REQUEST);
    expect(session.hostId).toBeTruthy();
    expect(agentRepo.registeredOrigins).toEqual([SESSION_REQUEST.hostId]);
    expect(session.hostId).not.toBe(SESSION_REQUEST.hostId);
  });

  test('failed registration cannot issue a session', async () => {
    const { service, agentRepo } = build();
    spyOn(agentRepo, 'registerHost').mockRejectedValue(new Error('registry unavailable'));
    const saveSession = spyOn(agentRepo, 'saveSession');

    await expect(service.openSession(SESSION_REQUEST)).rejects.toThrow('registry unavailable');
    expect(saveSession).not.toHaveBeenCalled();
  });

  // A default host would hand desired state to anything that reached the port.
  test('an unknown token is refused rather than resolved to a host', async () => {
    const { service } = build();

    await expect(service.hostForSession({ sessionToken: 'not-a-session' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

describe('a session is held for the lifetime its host was told about', () => {
  // The lifetime used to be announced and never recorded, so nothing held the session to it.
  test('the expiry the host is given is the one the session is saved under', async () => {
    const { service, agentRepo } = build();

    const session = await service.openSession(SESSION_REQUEST);

    expect(agentRepo.sessionExpiresAt?.toISOString()).toBe(session.expiresAt);
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
  test('a mismatched host is refused before any observation or mutation', async () => {
    const { apps, deployments, exports, service } = build();
    const reported = {
      hostId: Value.Parse(HostIdSchema, 'another-host'),
      instances: [],
      volumes: [],
      exports: [],
    } as unknown as HostReportedState;
    await expect(
      service.acceptReport({ reported, hostId: Value.Parse(HostIdSchema, 'session-host') }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(apps.trace).toEqual([]);
    expect(deployments.reports).toEqual([]);
    expect(exports.reports).toEqual([]);
  });
  test('and by each of them, so no part of it is dropped on the way in', async () => {
    const { deployments, exports, service } = build();
    const reported = {
      hostId: Value.Parse(HostIdSchema, 'host-1'),
      instances: [],
      volumes: [],
      exports: [],
    } as unknown as HostReportedState;

    await service.acceptReport({ reported, hostId: reported.hostId });

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

    await service.acceptReport({ reported, hostId: reported.hostId });

    expect(apps.trace).toEqual([
      'recordVolumeUsage',
      'recordDataInitialized',
      'recordComputeUsage',
      'completeDeletions',
      'expire',
      'finishDeletions',
      'purgeDeleted',
    ]);
  });

  // Nothing in the report says anything about hostnames. It is borrowed as a clock, because
  // whether an owner has pointed their domain at us happens in DNS with nobody to announce it.
  test('and the clock it lends is what advances a custom hostname nobody announced', async () => {
    const { artifacts, imports, hostnames, volumeStorageMigrations, service } = build();
    const reported = {
      hostId: Value.Parse(HostIdSchema, 'host-1'),
      instances: [],
      volumes: [],
      exports: [],
    } as unknown as HostReportedState;

    await service.acceptReport({ reported, hostId: reported.hostId });

    expect(artifacts.swept).toBe(1);
    expect(imports.swept).toBe(1);
    // The archives this report's own `ready` volumes just made unusable go on the same pass.
    expect(imports.sweptSpent).toBe(1);
    expect(hostnames.reconciled).toBe(1);
    expect(volumeStorageMigrations.swept).toBe(1);
  });
});

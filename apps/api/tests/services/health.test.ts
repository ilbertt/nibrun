import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_AGENT_POLL_SETTINGS,
  HostIdSchema,
  type HostState,
  type Timestamp,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import type { HostObservation } from '#repositories/agent.repository.ts';
import type { HealthRepositoryContract } from '#repositories/health.repository.ts';
import { HealthService, type SystemHealth } from '#services/health.service.ts';

const HOST_ID = Value.Parse(HostIdSchema, 'host-1');

const REPORTS_BEFORE_SILENT = 3;
const ONE_MS = 1;

/** Past the three reports' silence the service allows, and not a moment more than it has to be. */
const SILENT_MS = DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs * REPORTS_BEFORE_SILENT + ONE_MS;

function agoAsTimestamp(ms: number): Timestamp {
  return Value.Parse(TimestampSchema, new Date(Date.now() - ms).toISOString());
}

function observation({
  state = 'ready',
  silentFor = 0,
}: {
  state?: HostState;
  silentFor?: number;
} = {}): HostObservation {
  return { hostId: HOST_ID, reportedAt: agoAsTimestamp(silentFor), state };
}

type Reachability = { database?: boolean; logStore?: boolean; objectStore?: boolean };

class FakeHealthRepository implements HealthRepositoryContract {
  readonly #reachable: Required<Reachability>;

  constructor({ database = true, logStore = true, objectStore = true }: Reachability = {}) {
    this.#reachable = { database, logStore, objectStore };
  }

  pingDatabase(): Promise<void> {
    return this.#answer('database');
  }

  pingLogStore(): Promise<void> {
    return this.#answer('logStore');
  }

  pingObjectStore(): Promise<void> {
    return this.#answer('objectStore');
  }

  #answer(name: keyof Reachability): Promise<void> {
    return this.#reachable[name]
      ? Promise.resolve()
      : Promise.reject(new Error(`${name} is unreachable`));
  }
}

function check({
  reachability,
  observed,
}: {
  reachability?: Reachability;
  observed?: HostObservation;
} = {}): Promise<SystemHealth> {
  return new HealthService({
    healthRepo: new FakeHealthRepository(reachability),
    agentRepo: { lastObservation: () => Promise.resolve(observed) },
  }).check();
}

describe('HealthService', () => {
  test('is healthy when every dependency answers and a host is reporting', async () => {
    const health = await check({ observed: observation() });

    expect(health.status).toBe('healthy');
    expect(health.components).toEqual({
      database: { status: 'up' },
      logStore: { status: 'up' },
      objectStore: { status: 'up' },
      agent: { status: 'up' },
      appHost: { status: 'up' },
    });
  });

  test('reports uptime alongside the components', async () => {
    const health = await check({ observed: observation() });

    expect(health.uptime).toBeGreaterThan(0);
  });

  test.each([
    { name: 'database', reachability: { database: false } },
    { name: 'logStore', reachability: { logStore: false } },
    { name: 'objectStore', reachability: { objectStore: false } },
  ] as const)('an unreachable $name degrades the whole system', async ({ name, reachability }) => {
    const health = await check({ reachability, observed: observation() });

    expect(health.status).toBe('degraded');
    expect(health.components[name]).toEqual({ status: 'down' });
  });

  test('a refusal does not carry the dependency’s own words out to an open route', async () => {
    const health = await check({ reachability: { database: false }, observed: observation() });

    expect(health.components.database.detail).toBeUndefined();
  });

  test('the other components still answer when one dependency is unreachable', async () => {
    const health = await check({ reachability: { logStore: false }, observed: observation() });

    expect(health.components.database.status).toBe('up');
    expect(health.components.objectStore.status).toBe('up');
  });

  describe('the agent', () => {
    test('is down before any host has reported', async () => {
      const health = await check();

      expect(health.status).toBe('degraded');
      expect(health.components.agent.status).toBe('down');
      expect(health.components.agent.detail).toBeDefined();
    });

    test('is up while reports keep arriving', async () => {
      const health = await check({ observed: observation({ silentFor: 0 }) });

      expect(health.components.agent).toEqual({ status: 'up' });
    });

    test('is down once it has gone quiet for longer than three reports', async () => {
      const health = await check({ observed: observation({ silentFor: SILENT_MS }) });

      expect(health.status).toBe('degraded');
      expect(health.components.agent.status).toBe('down');
    });
  });

  describe('the app host', () => {
    test('is unknown rather than down when nothing has reported one', async () => {
      const health = await check();

      expect(health.components.appHost.status).toBe('unknown');
    });

    test('is unknown when the agent that reports it has gone quiet', async () => {
      const health = await check({ observed: observation({ silentFor: SILENT_MS }) });

      expect(health.components.appHost.status).toBe('unknown');
    });

    test.each([
      { state: 'ready', status: 'up' },
      { state: 'registering', status: 'unknown' },
      { state: 'draining', status: 'unknown' },
      { state: 'unreachable', status: 'down' },
    ] as const)('reported as $state reads as $status', async ({ state, status }) => {
      const health = await check({ observed: observation({ state }) });

      expect(health.components.appHost.status).toBe(status);
    });

    test('says which state it was reported in when that is not ready', async () => {
      const health = await check({ observed: observation({ state: 'draining' }) });

      expect(health.components.appHost.detail).toContain('draining');
    });
  });
});

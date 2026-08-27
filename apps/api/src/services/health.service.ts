import { DEFAULT_AGENT_POLL_SETTINGS, type HostState } from '@repo/protocol';
import type { AgentRepositoryContract, HostObservation } from '#repositories/agent.repository.ts';
import type { HealthRepositoryContract } from '#repositories/health.repository.ts';
import { Service } from '#services/service.ts';

/**
 * How long a probe has to answer in. The dashboard asks on a timer, so a dependency that hangs
 * rather than refusing has to become an answer here — otherwise it becomes a request that never
 * completes, and a reader is told the api is unreachable when it is the one thing that is not.
 */
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Reports arrive on a fixed cadence, so silence is only meaningful in multiples of it. Three
 * gives a host a missed report and a slow one before it is called gone.
 */
const REPORTS_BEFORE_SILENT = 3;
const SILENT_AFTER_MS = DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs * REPORTS_BEFORE_SILENT;

const MS_PER_SECOND = 1_000;

/**
 * `unknown` is not a softer `down`: it is this end having no way to see. Only the host is ever
 * that, because the agent is the only window onto it — an agent that has stopped reporting takes
 * the host's status with it rather than proving anything about it.
 */
export type ComponentStatus = 'up' | 'down' | 'unknown';

export type Component = {
  status: ComponentStatus;
  /** Why, when the status alone does not say it. Never a dependency's own words — see `probe`. */
  detail?: string;
};

const HOST_STATE_STATUS: Record<HostState, ComponentStatus> = {
  registering: 'unknown',
  ready: 'up',
  draining: 'unknown',
  unreachable: 'down',
};

export type SystemHealth = {
  status: 'healthy' | 'degraded';
  uptime: number;
  components: {
    database: Component;
    logStore: Component;
    objectStore: Component;
    agent: Component;
    appHost: Component;
  };
};

export class HealthService extends Service {
  private readonly healthRepo: HealthRepositoryContract;
  private readonly agentRepo: HostObserver;

  constructor({
    healthRepo,
    agentRepo,
  }: { healthRepo: HealthRepositoryContract; agentRepo: HostObserver }) {
    super();
    this.healthRepo = healthRepo;
    this.agentRepo = agentRepo;
  }

  /**
   * Together rather than in turn: nothing here reads what another returns, so a reader waits on
   * the slowest dependency instead of on the sum of them.
   */
  async check(): Promise<SystemHealth> {
    const [database, logStore, objectStore, observation] = await Promise.all([
      this.probe({ component: 'database', run: () => this.healthRepo.pingDatabase() }),
      this.probe({ component: 'logStore', run: () => this.healthRepo.pingLogStore() }),
      this.probe({ component: 'objectStore', run: () => this.healthRepo.pingObjectStore() }),
      this.agentRepo.lastObservation(),
    ]);

    const silence = silenceSince(observation);
    const components = {
      database,
      logStore,
      objectStore,
      agent: agentComponent(silence),
      appHost: appHostComponent({ observation, silence }),
    };

    return {
      status: Object.values(components).every((component) => component.status === 'up')
        ? 'healthy'
        : 'degraded',
      uptime: process.uptime(),
      components,
    };
  }

  /**
   * What a dependency said when it refused is logged, not returned. This route answers
   * unauthenticated — it is what the container's own probe calls — and a driver's error text
   * carries the host, port and user it was dialling.
   */
  private async probe({
    component,
    run,
  }: {
    component: keyof SystemHealth['components'];
    run: () => Promise<void>;
  }): Promise<Component> {
    try {
      await withTimeout(run());
      return { status: 'up' };
    } catch (failure) {
      this.logger.warn('health probe failed', { component, failure });
      return { status: 'down' };
    }
  }
}

/** The whole of what health asks of the agent: what the last report said, if there was one. */
export type HostObserver = Pick<AgentRepositoryContract, 'lastObservation'>;

class ProbeTimeout extends Error {
  constructor() {
    super(`no answer within ${PROBE_TIMEOUT_MS}ms`);
    this.name = 'ProbeTimeout';
  }
}

/**
 * The timer is cleared either way: a probe answering in a millisecond must not then hold the
 * event loop open for the rest of the budget, which is what a bare `setTimeout` race does — and
 * this runs three of them on every poll of every open dashboard.
 */
function withTimeout(work: Promise<void>): Promise<void> {
  const expiry = Promise.withResolvers<never>();
  const timer = setTimeout(() => expiry.reject(new ProbeTimeout()), PROBE_TIMEOUT_MS);
  return Promise.race([work, expiry.promise]).finally(() => clearTimeout(timer));
}

/** How long since the host last said anything, or nothing at all if it never has. */
function silenceSince(observation: HostObservation | undefined): number | undefined {
  return observation === undefined ? undefined : Date.now() - Date.parse(observation.reportedAt);
}

function agentComponent(silence: number | undefined): Component {
  if (silence === undefined) {
    return { status: 'down', detail: 'no host has reported to this api yet' };
  }
  return silence > SILENT_AFTER_MS
    ? { status: 'down', detail: `no report in the last ${SILENT_AFTER_MS / MS_PER_SECOND}s` }
    : { status: 'up' };
}

function appHostComponent({
  observation,
  silence,
}: {
  observation: HostObservation | undefined;
  silence: number | undefined;
}): Component {
  if (observation === undefined || silence === undefined) {
    return { status: 'unknown', detail: 'nothing has reported a host' };
  }
  if (silence > SILENT_AFTER_MS) {
    return { status: 'unknown', detail: 'the agent has stopped reporting it' };
  }
  const status = HOST_STATE_STATUS[observation.state];
  return status === 'up' ? { status } : { status, detail: `reported as ${observation.state}` };
}

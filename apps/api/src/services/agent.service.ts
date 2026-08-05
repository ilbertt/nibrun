import {
  type AgentSession,
  type AgentSessionRequest,
  DEFAULT_AGENT_POLL_SETTINGS,
  type HostDesiredState,
  type HostId,
  type HostReportedState,
  type SecretString,
  type Timestamp,
} from '@repo/protocol';
import {
  hostnamesByApp,
  THE_APP_HOST,
  toDesiredInstance,
  toDesiredVolume,
} from '#lib/desired-state.ts';
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type { DeploymentsRepositoryContract } from '#repositories/deployments.repository.ts';
import type { DesiredStateRepositoryContract } from '#repositories/desired-state.repository.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
const SESSION_LIFETIME_MS = SECONDS_PER_HOUR * MS_PER_SECOND;

export type DeploymentObservation = Pick<DeploymentsRepositoryContract, 'applyReport'>;

export class AgentService extends Service {
  private readonly agentRepo: AgentRepositoryContract;
  private readonly desiredStateRepo: DesiredStateRepositoryContract;
  private readonly deploymentsRepo: DeploymentObservation;

  constructor({
    agentRepo,
    desiredStateRepo,
    deploymentsRepo,
  }: {
    agentRepo: AgentRepositoryContract;
    desiredStateRepo: DesiredStateRepositoryContract;
    deploymentsRepo: DeploymentObservation;
  }) {
    super();
    this.agentRepo = agentRepo;
    this.desiredStateRepo = desiredStateRepo;
    this.deploymentsRepo = deploymentsRepo;
  }

  /**
   * Anything that reaches this endpoint gets a session.
   *
   * The reachability is the control: the internal port answers inside the VPC only, and a
   * tenant is dropped by its host's ruleset before it can route to it. The shared secret this
   * used to check was readable on every host, so it could not distinguish the callers it was
   * defending against from the ones it was admitting.
   */
  async openSession(request: AgentSessionRequest): Promise<AgentSession> {
    // Whatever the agent presents, there is one host and this is it. The agent persists what
    // it is given and comes back with it, so a reinstalled host rejoins as the same one.
    const hostId = THE_APP_HOST;
    const sessionToken = crypto.randomUUID() as SecretString;
    await this.agentRepo.saveSession({ sessionToken, hostId });

    this.logger.info('agent session opened', {
      hostId,
      agent: request.versions.agent,
      guestImage: request.versions.guestImage,
    });

    return {
      hostId,
      sessionToken,
      expiresAt: new Date(Date.now() + SESSION_LIFETIME_MS).toISOString() as Timestamp,
      poll: DEFAULT_AGENT_POLL_SETTINGS,
    };
  }

  /**
   * Which host is calling. Desired state carries no host id — the session is the identity, so a
   * host can only ever be told about itself.
   */
  async hostForSession({ sessionToken }: { sessionToken: string }): Promise<HostId> {
    const hostId = await this.agentRepo.hostForSession({ sessionToken });
    if (!hostId) {
      throw new UnauthorizedError('Unknown or expired session.');
    }
    return hostId;
  }

  /**
   * The generation is read before the rows, not after.
   *
   * A change landing between the two reads then labels newer rows with an older generation,
   * which costs one redundant poll. Reading it afterwards would label older rows with a newer
   * generation, and the host would sit on stale state believing it had converged.
   */
  async desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    const generation = await this.desiredStateRepo.generation();
    const [deployments, volumes, hostnameRows] = await Promise.all([
      this.desiredStateRepo.runningDeployments(),
      this.desiredStateRepo.appVolumes(),
      this.desiredStateRepo.deployedHostnames(),
    ]);

    const hostnames = hostnamesByApp(hostnameRows);

    return {
      hostId,
      generation,
      volumes: volumes.map(toDesiredVolume),
      instances: deployments.map((row) =>
        toDesiredInstance({ row, hostnames: hostnames.get(row.app_id) ?? [] }),
      ),
      // Neither has a table yet, so a host is told there are none rather than told nothing.
      checkpoints: [],
      exports: [],
    };
  }

  async acceptReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      observedGeneration: reported.observedGeneration,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    await this.deploymentsRepo.applyReport({ instances: reported.instances });
  }
}

import {
  type AgentSession,
  type AgentSessionRequest,
  DEFAULT_AGENT_POLL_SETTINGS,
  type DesiredStateResponse,
  type HostId,
  type HostReportedState,
  type SecretString,
  type Timestamp,
} from '@repo/protocol';
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
const SESSION_LIFETIME_MS = SECONDS_PER_HOUR * MS_PER_SECOND;

export class AgentService extends Service {
  private readonly agentRepo: AgentRepositoryContract;
  private readonly deploymentsService: DeploymentsService;

  constructor({
    agentRepo,
    deploymentsService,
  }: {
    agentRepo: AgentRepositoryContract;
    deploymentsService: DeploymentsService;
  }) {
    super();
    this.agentRepo = agentRepo;
    this.deploymentsService = deploymentsService;
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
    // The agent persists what it is given and presents it next time, so a host keeps its
    // identity across a reinstall. Nothing allocates one yet, so its own is honoured.
    const hostId = request.hostId ?? (crypto.randomUUID() as HostId);
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
   * A host is told its state or told it already has it. Which of the two is a question about
   * desired state rather than about HTTP, so it is answered here and the route reports it.
   */
  async desiredState({
    hostId,
    knownGeneration,
  }: {
    hostId: HostId;
    knownGeneration: number;
  }): Promise<DesiredStateResponse> {
    const state = await this.agentRepo.desiredState({ hostId });
    return knownGeneration === state.generation
      ? { result: 'unchanged', generation: state.generation }
      : { result: 'changed', state };
  }

  /**
   * Only what the report says about deployments is kept. Capacity, versions and the host's own
   * state have no table to land in while hosts are not modelled, and holding them in this process
   * would be a second source of truth to unpick once they do.
   */
  async acceptReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      observedGeneration: reported.observedGeneration,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    await this.deploymentsService.applyHostReport({ reported });
  }
}

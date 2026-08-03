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
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepository } from '#repositories/agent.repository.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
const SESSION_LIFETIME_MS = SECONDS_PER_HOUR * MS_PER_SECOND;

export class AgentService extends Service {
  private readonly agentRepo: AgentRepository;
  private readonly bootstrapToken: string;

  constructor({
    agentRepo,
    bootstrapToken,
  }: {
    agentRepo: AgentRepository;
    bootstrapToken: string;
  }) {
    super();
    this.agentRepo = agentRepo;
    this.bootstrapToken = bootstrapToken;
  }

  /**
   * One credential for the fleet, because Terraform generates one and every host reads it from
   * the same SSM path. It buys exactly one thing — a session — so revoking a host becomes
   * expiring that session rather than rotating a secret baked into an instance.
   */
  async openSession(request: AgentSessionRequest): Promise<AgentSession> {
    if (!timingSafeEquals({ presented: request.bootstrapToken, expected: this.bootstrapToken })) {
      throw new UnauthorizedError('Bootstrap token rejected.');
    }

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

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    return this.agentRepo.desiredState({ hostId });
  }

  async acceptReport({ reported }: { reported: HostReportedState }): Promise<number> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      observedGeneration: reported.observedGeneration,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    await this.agentRepo.saveReportedState({ reported });

    const desired = await this.agentRepo.desiredState({ hostId: reported.hostId });
    return desired.generation;
  }
}

function timingSafeEquals({ presented, expected }: { presented: string; expected: string }) {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

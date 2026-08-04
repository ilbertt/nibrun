import {
  type AgentSession,
  type AgentSessionRequest,
  DEFAULT_AGENT_POLL_SETTINGS,
  type HostDesiredState,
  type HostId,
  type HostReportedState,
  type SecretString,
  type TenantLogEvent,
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

  constructor({ agentRepo }: { agentRepo: AgentRepository }) {
    super();
    this.agentRepo = agentRepo;
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

  desiredState({ hostId }: { hostId: HostId }): Promise<HostDesiredState> {
    return this.agentRepo.desiredState({ hostId });
  }

  /**
   * Written to this service's own log rather than to Postgres, which is where it is going. What
   * is on the wire is worth seeing before deciding what a row looks like — in particular how much
   * of it is `gap`, since a stream that is mostly gaps is a buffer that needs sizing rather than
   * a schema that needs designing.
   */
  async ingestTenantLogs({
    hostId,
    events,
  }: {
    hostId: HostId;
    events: AsyncIterable<TenantLogEvent>;
  }): Promise<void> {
    let accepted = 0;
    for await (const event of events) {
      accepted += 1;
      const source = {
        hostId,
        appId: event.appId,
        instanceId: event.instanceId,
        sourceId: event.sourceId,
        sequence: event.sequence,
      };
      if (event.kind === 'gap') {
        this.logger.warn('tenant log gap', { ...source, droppedBytes: event.droppedBytes });
        continue;
      }
      this.logger.info('tenant log', { ...source, stream: event.stream, text: event.text });
    }
    this.logger.info('tenant log stream ended', { hostId, accepted });
  }

  async acceptReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      observedGeneration: reported.observedGeneration,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    await this.agentRepo.saveReportedState({ reported });
  }
}

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
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { ExportsService } from '#services/exports.service.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
const SESSION_LIFETIME_MS = SECONDS_PER_HOUR * MS_PER_SECOND;

export class AgentService extends Service {
  private readonly agentRepo: AgentRepositoryContract;
  private readonly deploymentsService: DeploymentsService;
  private readonly appsService: AppsService;
  private readonly exportsService: ExportsService;

  constructor({
    agentRepo,
    deploymentsService,
    appsService,
    exportsService,
  }: {
    agentRepo: AgentRepositoryContract;
    deploymentsService: DeploymentsService;
    appsService: AppsService;
    exportsService: ExportsService;
  }) {
    super();
    this.agentRepo = agentRepo;
    this.deploymentsService = deploymentsService;
    this.appsService = appsService;
    this.exportsService = exportsService;
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
   * Read by the things that own what it talks about: the releases running on the host, the apps
   * whose filesystems it is holding or has just let go of, and the bundles it was told to write.
   *
   * The rest is dropped. Capacity, versions and the host's own state have no table to land in
   * while hosts are not modelled, and holding them in this process would be a second source of
   * truth to unpick once they do.
   */
  async acceptReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    await this.deploymentsService.applyHostReport({ reported });
    await this.appsService.completeDeletions({ volumes: reported.volumes });
    await this.exportsService.applyHostReport({ reported });
  }
}

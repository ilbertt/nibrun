import {
  type AgentSession,
  type AgentSessionRequest,
  DEFAULT_AGENT_POLL_SETTINGS,
  type HostDesiredState,
  type HostId,
  HostIdSchema,
  type HostReportedState,
  SecretStringSchema,
  TimestampSchema,
  Value,
} from '@repo/protocol';
import { UnauthorizedError } from '#lib/errors.ts';
import type { AgentRepositoryContract } from '#repositories/agent.repository.ts';
import type { AppsService } from '#services/apps.service.ts';
import type { ArtifactsService } from '#services/artifacts.service.ts';
import type { DeploymentsService } from '#services/deployments.service.ts';
import type { ExportsService } from '#services/exports.service.ts';
import type { HostnamesService } from '#services/hostnames.service.ts';
import { Service } from '#services/service.ts';

const MS_PER_SECOND = 1000;
const SECONDS_PER_HOUR = 60 * 60;
const SESSION_LIFETIME_MS = SECONDS_PER_HOUR * MS_PER_SECOND;

/** What a report is borrowed for, and nothing else artifacts can do. */
export type UploadSweep = Pick<ArtifactsService, 'sweepAbandoned'>;

/** Likewise for hostnames: a report is the clock, not permission to add or remove one. */
export type HostnameReconcile = Pick<HostnamesService, 'reconcile'>;

export class AgentService extends Service {
  private readonly agentRepo: AgentRepositoryContract;
  private readonly deploymentsService: DeploymentsService;
  private readonly appsService: AppsService;
  private readonly exportsService: ExportsService;
  private readonly artifactsService: UploadSweep;
  private readonly hostnamesService: HostnameReconcile;

  constructor({
    agentRepo,
    deploymentsService,
    appsService,
    exportsService,
    artifactsService,
    hostnamesService,
  }: {
    agentRepo: AgentRepositoryContract;
    deploymentsService: DeploymentsService;
    appsService: AppsService;
    exportsService: ExportsService;
    artifactsService: UploadSweep;
    hostnamesService: HostnameReconcile;
  }) {
    super();
    this.agentRepo = agentRepo;
    this.deploymentsService = deploymentsService;
    this.appsService = appsService;
    this.exportsService = exportsService;
    this.artifactsService = artifactsService;
    this.hostnamesService = hostnamesService;
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
    const hostId = request.hostId ?? Value.Parse(HostIdSchema, crypto.randomUUID());
    const sessionToken = Value.Parse(SecretStringSchema, crypto.randomUUID());
    await this.agentRepo.saveSession({ sessionToken, hostId });

    this.logger.info('agent session opened', {
      hostId,
      agent: request.versions.agent,
      guestImage: request.versions.guestImage,
    });

    return {
      hostId,
      sessionToken,
      expiresAt: Value.Parse(
        TimestampSchema,
        new Date(Date.now() + SESSION_LIFETIME_MS).toISOString(),
      ),
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
   * The rest is dropped. Capacity and versions have no table to land in while hosts are not
   * modelled, and holding them in this process would be a second source of truth to unpick once
   * they do. The host's own state is kept, but only as the passing observation liveness reads —
   * see `observeReport`.
   */
  async acceptReport({ reported }: { reported: HostReportedState }): Promise<void> {
    this.logger.info('host reported', {
      hostId: reported.hostId,
      state: reported.state,
      instances: reported.instances.length,
      volumes: reported.volumes.length,
    });
    // First, and unconditionally: what a report says about the host itself is the only thing
    // this end learns from one that nothing below records, and a report that goes on to fail
    // still arrived — which is the whole of what liveness asks.
    await this.agentRepo.observeReport({ reported });
    await this.deploymentsService.applyHostReport({ reported });
    await this.appsService.recordVolumeUsage({ volumes: reported.volumes });
    await this.appsService.recordComputeUsage({ instances: reported.instances });
    await this.appsService.completeDeletions({ volumes: reported.volumes });
    await this.exportsService.applyHostReport({ reported });
    // Last, because what an app leaves behind is only safe to remove once a host has said its
    // filesystem is gone — and `completeDeletions` above is where this report says so.
    await this.appsService.finishDeletions();
    await this.appsService.purgeDeleted();
    // Nothing to do with this report. A report is simply the clock this process has, and an
    // upload nobody ever came back about is work that needs one.
    await this.artifactsService.sweepAbandoned();
    // The same clock, for the same reason: whether a custom hostname has been pointed at us is
    // decided in somebody else's DNS, so there is no moment to act on but a passing one.
    await this.hostnamesService.reconcile();
  }
}

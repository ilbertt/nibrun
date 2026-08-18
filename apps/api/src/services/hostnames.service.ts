import type { AppId, Hostname, OwnerId } from '@repo/protocol';
import { isPlatformHostname, type PublicAppHostname, toAppHostname } from '#lib/app-hostname.ts';
import { MS_PER_DAY } from '#lib/duration.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import { isUniqueViolation } from '#lib/pg-errors.ts';
import type {
  AppHostnameRow,
  AppHostnamesRepositoryContract,
} from '#repositories/app-hostnames.repository.ts';
import type { CustomHostnamesRepositoryContract } from '#repositories/custom-hostnames.repository.ts';
import { Service } from '#services/service.ts';

type OwnedApp = { appId: AppId; ownerId: OwnerId };

const HOSTNAME_TAKEN = 'app_hostnames_hostname_key';

/**
 * How many waiting hostnames one host report asks the edge about. Each is its own round trip to
 * Cloudflare on the way through a request a host is blocked on, and a hostname the owner has not
 * pointed at us yet is in no hurry — the next report takes the next batch.
 */
const POLL_BATCH = 8;

/**
 * How long a hostname may sit unproved before the claim on it lapses. Uniqueness is
 * platform-wide, so an unexpired claim is one owner holding a name every other owner is refused
 * — and the owner who actually controls the domain is the one who would be refused.
 *
 * Long enough to cross a weekend, because pointing DNS at us is usually somebody else's ticket.
 */
const PENDING_TTL_DAYS = 7;
const PENDING_TTL_MS = PENDING_TTL_DAYS * MS_PER_DAY;

/**
 * Custom domains, which live either side of a boundary this process does not control: a row here
 * saying what an owner asked for, a hostname at the edge that can serve it, and the owner's own
 * DNS deciding whether it ever does.
 *
 * Nothing here proves ownership itself. Pointing DNS at us *is* the proof — the edge cannot issue
 * a certificate until the records are in place — so this service's job is to keep the row and the
 * edge agreeing about what happened, not to adjudicate who owns what.
 */
export class HostnamesService extends Service {
  private readonly hostnamesRepo: AppHostnamesRepositoryContract;
  private readonly customHostnamesRepo: CustomHostnamesRepositoryContract;
  private readonly appHostDomain: string;

  constructor({
    hostnamesRepo,
    customHostnamesRepo,
    appHostDomain,
  }: {
    hostnamesRepo: AppHostnamesRepositoryContract;
    customHostnamesRepo: CustomHostnamesRepositoryContract;
    appHostDomain: string;
  }) {
    super();
    this.hostnamesRepo = hostnamesRepo;
    this.customHostnamesRepo = customHostnamesRepo;
    this.appHostDomain = appHostDomain;
  }

  /**
   * The row first, then the edge: a row with no hostname behind it is found by the pass below and
   * finished, while a hostname at the edge with no row naming it is invisible to everything here.
   *
   * The edge call is made while the owner waits rather than deferred, because what comes back is
   * the record they have to go and place — deferring it would mean answering the request with
   * nothing to act on.
   */
  async add({
    appId,
    ownerId,
    hostname,
  }: OwnedApp & { hostname: Hostname }): Promise<PublicAppHostname> {
    this.refuseWithoutEdge();
    if (isPlatformHostname({ hostname, appHostDomain: this.appHostDomain })) {
      throw new BadRequestError(
        `${this.appHostDomain} hostnames are issued by nibrun and cannot be added as custom domains.`,
      );
    }

    const row = await this.insert({ appId, ownerId, hostname });
    const { cloudflareId, state } = await this.customHostnamesRepo.add({ hostname });
    const dcvTarget = await this.customHostnamesRepo.dcvTarget({ hostname });
    const attached = await this.hostnamesRepo.attachCustom({
      hostname,
      cloudflareId,
      dcvTarget,
    });

    this.logger.info('custom hostname added', { appId, hostname, state });

    return toAppHostname(attached ?? { ...row, state, dcv_target: dcvTarget });
  }

  private async insert({
    appId,
    ownerId,
    hostname,
  }: OwnedApp & { hostname: Hostname }): Promise<AppHostnameRow> {
    try {
      const row = await this.hostnamesRepo.addCustom({ appId, ownerId, hostname });
      if (!row) {
        throw new NotFoundError('App not found.');
      }
      return row;
    } catch (error) {
      if (isUniqueViolation({ error, constraint: HOSTNAME_TAKEN })) {
        throw new ConflictError('That hostname is already in use.');
      }
      throw error;
    }
  }

  /**
   * The row goes whatever the edge says. A hostname left at the edge is picked up as an orphan by
   * the pass below; a row left behind is a name nobody can re-add and an owner told the removal
   * failed for a reason they cannot act on.
   */
  async remove({ appId, ownerId, hostname }: OwnedApp & { hostname: Hostname }): Promise<void> {
    const cloudflareId = await this.hostnamesRepo.removeCustom({ appId, ownerId, hostname });
    if (cloudflareId === null) {
      throw new NotFoundError('Custom hostname not found.');
    }
    try {
      await this.customHostnamesRepo.remove({ cloudflareId });
    } catch (error) {
      this.logger.error('removing a custom hostname from the edge failed', {
        appId,
        hostname,
        error,
      });
    }

    this.logger.info('custom hostname removed', { appId, hostname });
  }

  /**
   * Asks the edge what became of the hostnames still waiting, and lets go of the ones nobody ever
   * pointed at us.
   *
   * Driven off the rows still pending rather than off a queue of work owed, so a pass that fails
   * part way is retried by the next report finding the same rows — and one hostname the edge
   * cannot answer for does not stop the rest.
   */
  async reconcile(): Promise<void> {
    const pending = await this.hostnamesRepo.listPendingCustom({ limit: POLL_BATCH });
    for (const row of pending) {
      await this.advance(row);
    }
  }

  private async advance(row: {
    hostname: Hostname;
    cloudflare_id: string | null;
    created_at: Date;
  }): Promise<void> {
    if (Date.now() - row.created_at.getTime() > PENDING_TTL_MS) {
      await this.expire(row);
      return;
    }
    try {
      // Written before the edge was asked, and the ask never arrived — the edge was away, or this
      // process died between the two. Finished here rather than left to lapse: the owner cannot
      // add it again while their own half-finished row holds the name.
      const cloudflareId = row.cloudflare_id ?? (await this.attachAtEdge(row));
      const state = await this.customHostnamesRepo.state({ cloudflareId });
      if (state && state !== 'pending') {
        await this.hostnamesRepo.setCustomState({ hostname: row.hostname, state });
        this.logger.info('custom hostname settled', { hostname: row.hostname, state });
      }
    } catch (error) {
      this.logger.error('reading a custom hostname from the edge failed', {
        hostname: row.hostname,
        error,
      });
    }
  }

  private async attachAtEdge(row: { hostname: Hostname }): Promise<string> {
    const { cloudflareId } = await this.customHostnamesRepo.add({ hostname: row.hostname });
    const dcvTarget = await this.customHostnamesRepo.dcvTarget({ hostname: row.hostname });
    await this.hostnamesRepo.attachCustom({ hostname: row.hostname, cloudflareId, dcvTarget });

    this.logger.info('custom hostname reached the edge on a later pass', {
      hostname: row.hostname,
    });
    return cloudflareId;
  }

  private async expire(row: { hostname: Hostname; cloudflare_id: string | null }): Promise<void> {
    if (row.cloudflare_id) {
      try {
        await this.customHostnamesRepo.remove({ cloudflareId: row.cloudflare_id });
      } catch (error) {
        this.logger.error('removing an expired custom hostname from the edge failed', {
          hostname: row.hostname,
          error,
        });
        return;
      }
    }
    await this.hostnamesRepo.setCustomState({ hostname: row.hostname, state: 'failed' });
    this.logger.info('custom hostname claim expired', { hostname: row.hostname });
  }

  /**
   * Refused before the row is written rather than after: a claim left behind by a deployment that
   * can never prove it is a name every other owner is then refused.
   */
  private refuseWithoutEdge(): void {
    if (!this.customHostnamesRepo.available) {
      throw new BadGatewayError('Custom domains are not configured on this deployment.');
    }
  }
}

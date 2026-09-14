import type { AppHostnameState, AppId, Hostname, OwnerId } from '@repo/protocol';
import {
  dcvMethodFor,
  isPlatformHostname,
  type PublicAppHostname,
  toAppHostname,
} from '#lib/app-hostname.ts';
import { CloudflareError, REQUEST_DEADLINE_MS } from '#lib/cloudflare/client.ts';
import { MS_PER_DAY } from '#lib/duration.ts';
import { BadGatewayError, BadRequestError, ConflictError, NotFoundError } from '#lib/errors.ts';
import type {
  AppHostnamesRepositoryContract,
  CustomHostnameRow,
} from '#repositories/app-hostnames.repository.ts';
import type { CustomHostnamesRepositoryContract } from '#repositories/custom-hostnames.repository.ts';
import { Service } from '#services/service.ts';

type OwnedApp = { appId: AppId; ownerId: OwnerId };

const HTTP_NOT_FOUND = 404;

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

/** What `add` asks the edge with the owner waiting: create the hostname, read the zone's dcv uuid. */
const EDGE_CALLS_PER_ADD = 2;
const ADD_DEADLINE_MS = EDGE_CALLS_PER_ADD * REQUEST_DEADLINE_MS;

/**
 * How long a row with no hostname behind it is left to the `add` that wrote it. Past the add's
 * own deadline it has either attached the hostname or given up, and only then is the row this
 * pass's to finish. As long again on top, because `created_at` is the database's clock and the
 * comparison is made on the process's.
 *
 * Without it the pass and the add race to create the same hostname: the pass runs on every host
 * report, the add takes a second, and whichever asks the edge second is refused as a duplicate.
 * When that is the add, the owner is told their domain failed while it was in fact registered.
 */
export const ADD_GRACE_MS = ADD_DEADLINE_MS + ADD_DEADLINE_MS;

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
  /**
   * Where the last pass stopped, so the next carries on from there and comes back round to the
   * first rows only after the last. Held in the process rather than written down: a restart
   * starting over from the top costs one lap, while a column saying when each row was last
   * asked would be written for every row on every host report.
   */
  private lastPolledId: string | null = null;

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
   *
   * A hostname the app already holds is not created again but said again, and `created` is how
   * the caller tells the two apart. Saying it again is what a waiting domain has to offer its
   * owner: the edge is asked to check it now, rather than when its own schedule next comes round.
   */
  async add({ appId, ownerId, hostname }: OwnedApp & { hostname: Hostname }): Promise<{
    hostname: PublicAppHostname;
    created: boolean;
  }> {
    this.refuseWithoutEdge();
    if (isPlatformHostname({ hostname, appHostDomain: this.appHostDomain })) {
      throw new BadRequestError(
        `${this.appHostDomain} hostnames are issued by nibrun and cannot be added as custom domains.`,
      );
    }

    const claim = await this.hostnamesRepo.addCustom({ appId, ownerId, hostname });
    if (!claim) {
      throw new NotFoundError('App not found.');
    }
    if (claim.outcome === 'taken') {
      throw new ConflictError('That hostname is already in use.');
    }
    if (claim.outcome === 'held') {
      return { hostname: await this.reassert({ appId, hostname, row: claim.row }), created: false };
    }

    const { cloudflareId, state, dcvTarget } = await this.register(hostname);
    const attached = await this.hostnamesRepo.attachCustom({
      hostname,
      cloudflareId,
      dcvTarget,
    });

    this.logger.info('custom hostname added', { appId, hostname, state });

    return {
      hostname: toAppHostname(attached ?? { ...claim.row, state, dcv_target: dcvTarget }),
      created: true,
    };
  }

  /**
   * Only a hostname still waiting has anything to ask the edge for. An active one is answered
   * on already; one the edge has not been told about yet is finished by the next pass, not by
   * asking sooner; and a failed one has lapsed or been given up by the edge, which nothing here
   * can undo — the row is what tells its owner to remove it and add it again.
   */
  private async reassert({
    appId,
    hostname,
    row,
  }: {
    appId: AppId;
    hostname: Hostname;
    row: CustomHostnameRow;
  }): Promise<PublicAppHostname> {
    if (row.state === 'failed') {
      throw new ConflictError('That domain failed validation. Remove it and add it again.');
    }
    if (row.state === 'pending' && row.cloudflare_id !== null) {
      await this.revalidate({ appId, hostname, cloudflareId: row.cloudflare_id });
    }
    return toAppHostname(row);
  }

  /**
   * The edge retries validation on its own, on a clock that backs off to hours; the owner who has
   * just fixed their records is the one who knows it is time.
   */
  private async revalidate({
    appId,
    hostname,
    cloudflareId,
  }: {
    appId: AppId;
    hostname: Hostname;
    cloudflareId: string;
  }): Promise<void> {
    try {
      await this.customHostnamesRepo.revalidate({ cloudflareId, method: dcvMethodFor(hostname) });
    } catch (error) {
      if (error instanceof CloudflareError && error.status === HTTP_NOT_FOUND) {
        throw new ConflictError(
          'The edge no longer holds that domain. Remove it and add it again.',
        );
      }
      throw error;
    }

    this.logger.info('custom hostname validation asked for again', { appId, hostname });
  }

  /**
   * The delegation target is only read for a hostname proved that way: an apex is proved over
   * HTTP, and a target handed to its owner would be a record to place that nothing ever reads.
   */
  private async register(
    hostname: Hostname,
  ): Promise<{ cloudflareId: string; state: AppHostnameState; dcvTarget: string | null }> {
    const method = dcvMethodFor(hostname);
    const { cloudflareId, state } = await this.customHostnamesRepo.add({ hostname, method });
    const dcvTarget =
      method === 'txt' ? await this.customHostnamesRepo.dcvTarget({ hostname }) : null;
    return { cloudflareId, state, dcvTarget };
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
    const pending = await this.hostnamesRepo.listPendingCustom({
      after: this.lastPolledId,
      limit: POLL_BATCH,
    });
    // Moved on before the batch is asked about, so a pass that dies part way is not repeated
    // from the same rows by the next.
    this.lastPolledId = pending.at(-1)?.id ?? this.lastPolledId;
    for (const row of pending) {
      await this.advance(row);
    }
  }

  private async advance(row: {
    hostname: Hostname;
    cloudflare_id: string | null;
    created_at: Date;
  }): Promise<void> {
    const age = Date.now() - row.created_at.getTime();
    if (age > PENDING_TTL_MS) {
      await this.expire(row);
      return;
    }
    if (row.cloudflare_id === null && age < ADD_GRACE_MS) {
      return;
    }
    try {
      // Written before the edge was asked, and the ask never arrived — the edge was away, or this
      // process died between the two. Finished here rather than left to lapse: the owner cannot
      // add it again while their own half-finished row holds the name.
      const cloudflareId = row.cloudflare_id ?? (await this.attachAtEdge(row));
      const report = await this.customHostnamesRepo.report({ cloudflareId });
      const changed = await this.hostnamesRepo.recordEdgeReport({
        hostname: row.hostname,
        report,
      });
      // Logged on change alone: the pass is on every host report, and a line per pass would bury
      // the few that say something — which, read back later, are what explain a slow domain.
      if (changed) {
        this.logger.info(
          report.state === 'pending' ? 'custom hostname still waiting' : 'custom hostname settled',
          { hostname: row.hostname, ...report },
        );
      }
    } catch (error) {
      this.logger.error('reading a custom hostname from the edge failed', {
        hostname: row.hostname,
        error,
      });
    }
  }

  private async attachAtEdge(row: { hostname: Hostname }): Promise<string> {
    const { cloudflareId, dcvTarget } = await this.register(row.hostname);
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

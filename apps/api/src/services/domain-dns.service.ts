import type { AppId, Hostname, OwnerId } from '@repo/protocol';
import { type DomainDnsRecord, dnsName } from '#lib/domain-dns.ts';
import { NotFoundError } from '#lib/errors.ts';
import type { AppHostnamesRepositoryContract } from '#repositories/app-hostnames.repository.ts';
import type { DnsRepositoryContract } from '#repositories/dns.repository.ts';
import { Service } from '#services/service.ts';

export type DomainDnsHostnamesRepositoryContract = Pick<
  AppHostnamesRepositoryContract,
  'listByApp'
>;

export class DomainDnsService extends Service {
  private readonly hostnamesRepo: DomainDnsHostnamesRepositoryContract;
  private readonly dnsRepo: DnsRepositoryContract;

  constructor({
    hostnamesRepo,
    dnsRepo,
  }: {
    hostnamesRepo: DomainDnsHostnamesRepositoryContract;
    dnsRepo: DnsRepositoryContract;
  }) {
    super();
    this.hostnamesRepo = hostnamesRepo;
    this.dnsRepo = dnsRepo;
  }

  async check({
    appId,
    ownerId,
    hostname,
  }: {
    appId: AppId;
    ownerId: OwnerId;
    hostname: Hostname;
  }): Promise<{ records: DomainDnsRecord[] }> {
    const hostnames = await this.hostnamesRepo.listByApp({ appId, ownerId });
    const domain = hostnames.find((each) => each.kind === 'custom' && each.hostname === hostname);
    const platform = hostnames.find((each) => each.kind === 'platform');
    if (!domain || !platform) {
      throw new NotFoundError('Custom hostname not found.');
    }
    const records: { hostname: string; target: string }[] = [
      { hostname, target: platform.hostname },
    ];
    if (domain.dcv_target) {
      records.push({ hostname: `_acme-challenge.${hostname}`, target: domain.dcv_target });
    }
    return { records: await Promise.all(records.map((record) => this.checkRecord(record))) };
  }

  private async checkRecord({
    hostname,
    target,
  }: {
    hostname: string;
    target: string;
  }): Promise<DomainDnsRecord> {
    try {
      const observedTargets = await this.dnsRepo.cnameTargets({ hostname });
      return {
        hostname,
        type: 'CNAME',
        target,
        matched: observedTargets.some((observed) => dnsName(observed) === dnsName(target)),
        observedTargets,
      };
    } catch (error) {
      this.logger.warn('checking a domain DNS record failed', { hostname, error });
      return { hostname, type: 'CNAME', target, matched: null, observedTargets: [] };
    }
  }
}

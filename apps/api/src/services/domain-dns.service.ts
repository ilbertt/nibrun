import type { AppId, Hostname } from '@repo/protocol';
import {
  dnsName,
  type RequiredDomainDnsRecord,
  requiredDomainDnsRecords,
} from '#lib/dns-records.ts';
import type { DomainDnsRecord } from '#lib/domain-dns.ts';
import { NotFoundError } from '#lib/errors.ts';
import type { AppHostnamesRepositoryContract } from '#repositories/app-hostnames.repository.ts';
import type { DnsRepositoryContract } from '#repositories/dns.repository.ts';
import type { OwnerId } from '#schemas/identifiers.ts';
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
    const records = requiredDomainDnsRecords({
      hostname,
      routingTarget: platform.hostname,
      dcvTarget: domain.dcv_target ?? undefined,
    });
    return { records: await Promise.all(records.map((record) => this.checkRecord(record))) };
  }

  private async checkRecord(record: RequiredDomainDnsRecord): Promise<DomainDnsRecord> {
    try {
      const observedTargets = await this.dnsRepo.cnameTargets({ hostname: record.hostname });
      return {
        ...record,
        matched: observedTargets.some((observed) => dnsName(observed) === dnsName(record.target)),
        observedTargets,
      };
    } catch (error) {
      this.logger.warn('checking a domain DNS record failed', { hostname: record.hostname, error });
      return { ...record, matched: null, observedTargets: [] };
    }
  }
}

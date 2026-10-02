import { CNAME_RECORD_TYPE, dnsName } from '@repo/protocol';
import type { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';

export abstract class DnsRepositoryContract {
  abstract cnameTargets(input: { hostname: string }): Promise<string[]>;
}

export class DnsRepository implements DnsRepositoryContract {
  private readonly client: CloudflareDnsClient;

  constructor(client: CloudflareDnsClient) {
    this.client = client;
  }

  async cnameTargets({ hostname }: { hostname: string }): Promise<string[]> {
    const answers = await this.client.queryCname({ hostname });
    return answers
      .filter(
        (record) =>
          record.type === CNAME_RECORD_TYPE.code && dnsName(record.name) === dnsName(hostname),
      )
      .map((record) => dnsName(record.data));
  }
}

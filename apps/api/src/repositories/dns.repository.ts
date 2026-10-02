import { Value } from '@repo/protocol';
import { t } from 'elysia';
import { dnsName } from '#lib/domain-dns.ts';

const CNAME_TYPE = 5;
const NO_ERROR = 0;
const NAME_ERROR = 3;
const DEADLINE_MS = 5_000;

const DnsResponseSchema = t.Object({
  Status: t.Integer(),
  TC: t.Optional(t.Boolean()),
  Answer: t.Optional(t.Array(t.Object({ name: t.String(), type: t.Integer(), data: t.String() }))),
});

export abstract class DnsRepositoryContract {
  abstract cnameTargets(input: { hostname: string }): Promise<string[]>;
}

export class DnsRepository implements DnsRepositoryContract {
  private readonly endpoint: string;

  constructor({ endpoint = 'https://cloudflare-dns.com/dns-query' }: { endpoint?: string } = {}) {
    this.endpoint = endpoint;
  }

  async cnameTargets({ hostname }: { hostname: string }): Promise<string[]> {
    const url = new URL(this.endpoint);
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', 'CNAME');
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (!response.ok) {
      throw new Error(`DNS resolver returned HTTP ${response.status}.`);
    }
    const answer = Value.Parse(DnsResponseSchema, await response.json());
    if (answer.TC || (answer.Status !== NO_ERROR && answer.Status !== NAME_ERROR)) {
      throw new Error(`DNS resolver could not answer the query (status ${answer.Status}).`);
    }
    return (answer.Answer ?? [])
      .filter((record) => record.type === CNAME_TYPE && dnsName(record.name) === dnsName(hostname))
      .map((record) => dnsName(record.data));
  }
}

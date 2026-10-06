import { Value } from '@sinclair/typebox/value';
import { t } from 'elysia';
import { CNAME_RECORD_TYPE } from '#lib/dns-records.ts';

const DNS_QUERY_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

const NO_ERROR = 0;
const NAME_ERROR = 3;
const REQUEST_DEADLINE_MS = 5_000;

const DnsAnswerSchema = t.Object({ name: t.String(), type: t.Integer(), data: t.String() });

export type CloudflareDnsAnswer = typeof DnsAnswerSchema.static;

const DnsResponseSchema = t.Object({
  Status: t.Integer(),
  TC: t.Optional(t.Boolean()),
  Answer: t.Optional(t.Array(DnsAnswerSchema)),
});

export class CloudflareDnsClient {
  async queryCname({ hostname }: { hostname: string }): Promise<CloudflareDnsAnswer[]> {
    const url = new URL(DNS_QUERY_ENDPOINT);
    url.searchParams.set('name', hostname);
    url.searchParams.set('type', CNAME_RECORD_TYPE.name);
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(REQUEST_DEADLINE_MS),
    });
    if (!response.ok) {
      throw new Error(`DNS resolver returned HTTP ${response.status}.`);
    }
    const answer = Value.Parse(DnsResponseSchema, await response.json());
    if (answer.TC || (answer.Status !== NO_ERROR && answer.Status !== NAME_ERROR)) {
      throw new Error(`DNS resolver could not answer the query (status ${answer.Status}).`);
    }
    return answer.Answer ?? [];
  }
}

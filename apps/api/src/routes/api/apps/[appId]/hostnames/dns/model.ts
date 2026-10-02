import { HostnameSchema } from '@repo/protocol';
import { t } from 'elysia';
import { DomainDnsRecordSchema } from '#lib/domain-dns.ts';

export const DomainDnsQuerySchema = t.Object(
  { hostname: HostnameSchema },
  { additionalProperties: false },
);
export const DomainDnsResponseSchema = t.Object({ records: t.Array(DomainDnsRecordSchema) });

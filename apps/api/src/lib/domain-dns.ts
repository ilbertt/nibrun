import { t } from 'elysia';
import { RequiredDomainDnsRecordSchema } from '#domain/dns.ts';

export const DomainDnsRecordSchema = t.Object({
  ...RequiredDomainDnsRecordSchema.properties,
  matched: t.Union([t.Boolean(), t.Null()]),
  observedTargets: t.Array(t.String()),
});

export type DomainDnsRecord = typeof DomainDnsRecordSchema.static;

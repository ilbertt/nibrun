import { RequiredDomainDnsRecordSchema } from '@repo/protocol';
import { t } from 'elysia';

export const DomainDnsRecordSchema = t.Object({
  ...RequiredDomainDnsRecordSchema.properties,
  matched: t.Union([t.Boolean(), t.Null()]),
  observedTargets: t.Array(t.String()),
});

export type DomainDnsRecord = typeof DomainDnsRecordSchema.static;
